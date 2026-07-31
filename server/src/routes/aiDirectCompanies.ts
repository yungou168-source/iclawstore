/**
 * AI Direct Hiring — Companies, Projects, AgentRoles routes (P2).
 *
 * Endpoints:
 *   Companies:  list, create, get, patch, delete
 *   Projects:   list, create, get, patch, delete
 *   Roles:      list by project, create, get, patch, delete
 */

import { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { AiDirectHiringError, ErrorCodes, errorResponse } from '../services/aiDirectErrors.js';
import { publishOutboxEvent } from '../utils/outbox.js';
import { requireAuth } from '../middleware/aiDirectAuth.js';
import {
  requireCompanyRole,
  CompanyMemberRow,
  CompanyRole,
} from '../middleware/aiDirectRbac.js';

// ─── Shared helpers ────────────────────────────────────────────────────────────

function requestIdFrom(request: { headers: Record<string, unknown> }): string {
  const value = request.headers['x-request-id'];
  return typeof value === 'string' && value.length > 0 && value.length <= 128
    ? value
    : randomUUID();
}

function readBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '请求体必须是对象');
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 必须是字符串`);
  }
  const result = value.trim();
  if (!result || result.length > maxLength) {
    throw new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      `${field} 长度必须为 1 到 ${maxLength}`,
    );
  }
  return result;
}

function rejectExtra(body: Record<string, unknown>, allowed: string[], caller: string): void {
  const extra = Object.keys(body).filter((k) => !allowed.includes(k));
  if (extra.length > 0) {
    throw new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      `${caller} 不接受以下字段: ${extra.join(', ')}`,
      400,
      { extraFields: extra },
    );
  }
}

async function writeAudit(
  conn: { query(sql: string, values?: unknown[]): Promise<unknown> },
  input: {
    organizationId: string | null;
    actorUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    requestId: string;
    outcome?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await conn.query(
    `INSERT INTO ai_direct_audit_events
     (id, organizationId, actorUserId, action, targetType, targetId, requestId, outcome, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      input.organizationId,
      input.actorUserId,
      input.action,
      input.targetType,
      input.targetId,
      input.requestId,
      input.outcome ?? 'success',
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function aiDirectCompaniesRoutes(fastify: FastifyInstance) {
  const pool = (fastify as any).mysql as any;
  const auth = [(fastify as any).authenticate];

  // ── Companies ────────────────────────────────────────────────────────────────

  // GET /api/v1/ai-direct-hiring/companies — list companies the user is a member of
  fastify.get('/companies', { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request);
    const [rows] = await pool.query(
      `SELECT c.id, c.organizationId, c.name, c.slug, c.status, c.createdAt, c.updatedAt,
              COALESCE(cm.role, m.role) AS companyRole
       FROM ai_direct_companies c
       JOIN ai_direct_organization_members m ON m.organizationId = c.organizationId AND m.userId = ?
       LEFT JOIN ai_direct_company_members cm ON cm.companyId = c.id AND cm.userId = m.userId
       WHERE c.organizationId IN (
         SELECT organizationId FROM ai_direct_organization_members WHERE userId = ? AND status = 'active'
       )
       ORDER BY c.updatedAt DESC LIMIT 100`,
      [user.id, user.id],
    );
    return { items: rows };
  });

  // POST /api/v1/ai-direct-hiring/companies — create company
  fastify.post('/companies', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const reqId = requestIdFrom(request);
    const body = readBody(request.body);
    rejectExtra(body, ['name', 'organizationId'], 'POST /companies');

    const name = readString(body.name, 'name', 160);
    const organizationId = readString(body.organizationId ?? '', 'organizationId', 36);

    // Verify user is an active org member
    const [orgRows] = await pool.query(
      `SELECT 1 FROM ai_direct_organization_members
       WHERE organizationId = ? AND userId = ? AND status = 'active' LIMIT 1`,
      [organizationId, user.id],
    );
    if (!(orgRows as any[]).length) {
      throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, '用户不是该组织的活跃成员', 403);
    }

    const companyId = randomUUID();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + companyId.slice(0, 8);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query(
        `INSERT INTO ai_direct_companies (id, organizationId, name, slug, status, createdByUserId)
         VALUES (?, ?, ?, ?, 'active', ?)`,
        [companyId, organizationId, name, slug, user.id],
      );

      // Auto-add creator as owner in company_members if the table exists
      await conn.query(
        `INSERT IGNORE INTO ai_direct_company_members (id, companyId, userId, role, status, createdAt, updatedAt)
         VALUES (?, ?, ?, 'owner', 'active', NOW(), NOW())`,
        [randomUUID(), companyId, user.id],
      ).catch(() => {/* table may not exist yet */});

      await writeAudit(conn, {
        organizationId,
        actorUserId: user.id,
        action: 'company.created',
        targetType: 'company',
        targetId: companyId,
        requestId: reqId,
        metadata: { name, slug },
      });

      await publishOutboxEvent(conn, {
        organizationId,
        aggregateType: 'company',
        aggregateId: companyId,
        eventType: 'company.created.v1',
        payload: { id: companyId, name, slug, organizationId },
      });

      await conn.commit();
      return reply.status(201).send({ id: companyId, name, slug, status: 'active' });
    } catch (err) {
      await conn.rollback();
      if ((err as any)?.code === 'ER_DUP_ENTRY') {
        return reply.status(409).send({
          code: ErrorCodes.DUPLICATE_ENTRY,
          error: '公司标识已存在',
        });
      }
      throw err;
    } finally {
      conn.release();
    }
  });

  // GET /api/v1/ai-direct-hiring/companies/:id — company detail
  fastify.get('/companies/:id', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const { id } = request.params;
    await requireCompanyRole(pool, id, user.id, 'member');

    const [rows] = await pool.query(
      `SELECT id, organizationId, name, slug, status, createdByUserId, createdAt, updatedAt
       FROM ai_direct_companies WHERE id = ? LIMIT 1`,
      [id],
    );
    const company = (rows as any[])[0];
    if (!company) {
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '公司不存在', 404);
    }
    return company;
  });

  // PATCH /api/v1/ai-direct-hiring/companies/:id — update company (needs admin)
  fastify.patch('/companies/:id', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const { id } = request.params;
    const body = readBody(request.body ?? {});
    rejectExtra(body, ['name', 'status'], 'PATCH /companies/:id');

    await requireCompanyRole(pool, id, user.id, 'admin');

    const updates: string[] = [];
    const params: unknown[] = [];

    if (body.name !== undefined) {
      const name = readString(body.name, 'name', 160);
      updates.push('name = ?');
      params.push(name);
    }
    if (body.status !== undefined) {
      const status = readString(body.status, 'status', 32);
      if (!['active', 'inactive', 'archived'].includes(status)) {
        throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '无效的 status 值');
      }
      updates.push('status = ?');
      params.push(status);
    }

    if (updates.length === 0) {
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '没有需要更新的字段');
    }

    params.push(id);
    const reqId = requestIdFrom(request);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`UPDATE ai_direct_companies SET ${updates.join(', ')}, updatedAt = NOW() WHERE id = ?`, params);

      await writeAudit(conn, {
        organizationId: null,
        actorUserId: user.id,
        action: 'company.updated',
        targetType: 'company',
        targetId: id,
        requestId: reqId,
        metadata: { updates: Object.keys(body) },
      });

      await conn.commit();
      const [rows] = await pool.query(
        `SELECT id, organizationId, name, slug, status, createdAt, updatedAt FROM ai_direct_companies WHERE id = ?`,
        [id],
      );
      return { ...(rows as any[])[0] };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  // DELETE /api/v1/ai-direct-hiring/companies/:id — delete company (creator only)
  fastify.delete('/companies/:id', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const { id } = request.params;

    const [rows] = await pool.query(
      `SELECT id, createdByUserId FROM ai_direct_companies WHERE id = ? LIMIT 1`,
      [id],
    );
    const company = (rows as any[])[0];
    if (!company) {
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '公司不存在', 404);
    }
    if (company.createdByUserId !== user.id) {
      throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, '只有创建者可以删除公司', 403);
    }

    const reqId = requestIdFrom(request);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`DELETE FROM ai_direct_companies WHERE id = ?`, [id]);

      await writeAudit(conn, {
        organizationId: null,
        actorUserId: user.id,
        action: 'company.deleted',
        targetType: 'company',
        targetId: id,
        requestId: reqId,
      });

      await conn.commit();
      return reply.status(204).send();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  // ── Projects ────────────────────────────────────────────────────────────────

  // GET /api/v1/ai-direct-hiring/projects — list projects user can see
  fastify.get('/projects', { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request);
    const [rows] = await pool.query(
      `SELECT p.id, p.companyId, p.name, p.slug, p.status, p.budgetMicros, p.sensitivityLimit,
              p.createdByUserId, p.createdAt, p.updatedAt,
              c.name AS companyName
       FROM ai_direct_projects p
       JOIN ai_direct_companies c ON c.id = p.companyId
       JOIN ai_direct_organization_members m ON m.organizationId = c.organizationId AND m.userId = ?
       WHERE c.organizationId IN (
         SELECT organizationId FROM ai_direct_organization_members WHERE userId = ? AND status = 'active'
       )
       ORDER BY p.updatedAt DESC LIMIT 100`,
      [user.id, user.id],
    );
    return { items: rows };
  });

  // POST /api/v1/ai-direct-hiring/projects — create project (needs company member)
  fastify.post('/projects', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const reqId = requestIdFrom(request);
    const body = readBody(request.body);
    rejectExtra(body, ['companyId', 'name', 'budgetMicros', 'sensitivityLimit'], 'POST /projects');

    const companyId = readString(body.companyId, 'companyId', 36);
    const name = readString(body.name, 'name', 160);
    await requireCompanyRole(pool, companyId, user.id, 'member');

    const projectId = randomUUID();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + projectId.slice(0, 8);
    const budgetMicros = typeof body.budgetMicros === 'number' ? BigInt(body.budgetMicros) : BigInt(0);
    const sensitivityLimit =
      typeof body.sensitivityLimit === 'string' ? body.sensitivityLimit : null;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query(
        `INSERT INTO ai_direct_projects
         (id, companyId, name, slug, status, budgetMicros, sensitivityLimit, createdByUserId)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
        [projectId, companyId, name, slug, budgetMicros, sensitivityLimit, user.id],
      );

      await writeAudit(conn, {
        organizationId: null,
        actorUserId: user.id,
        action: 'project.created',
        targetType: 'project',
        targetId: projectId,
        requestId: reqId,
        metadata: { companyId, name, slug },
      });

      await publishOutboxEvent(conn, {
        organizationId: null,
        aggregateType: 'project',
        aggregateId: projectId,
        eventType: 'project.created.v1',
        payload: { id: projectId, companyId, name, slug },
      });

      await conn.commit();
      return reply.status(201).send({ id: projectId, name, slug, status: 'active' });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  // GET /api/v1/ai-direct-hiring/projects/:id — project detail
  fastify.get('/projects/:id', { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request);
    const { id } = request.params;

    const [rows] = await pool.query(
      `SELECT p.id, p.companyId, p.name, p.slug, p.status, p.budgetMicros, p.sensitivityLimit,
              p.createdByUserId, p.createdAt, p.updatedAt,
              c.name AS companyName
       FROM ai_direct_projects p
       JOIN ai_direct_companies c ON c.id = p.companyId
       JOIN ai_direct_organization_members m ON m.organizationId = c.organizationId AND m.userId = ?
       WHERE p.id = ? LIMIT 1`,
      [user.id, id],
    );
    const project = (rows as any[])[0];
    if (!project) {
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '项目不存在', 404);
    }
    return project;
  });

  // PATCH /api/v1/ai-direct-hiring/projects/:id — update project
  fastify.patch('/projects/:id', { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request);
    const { id } = request.params;
    const body = readBody(request.body ?? {});
    rejectExtra(body, ['name', 'status', 'budgetMicros', 'sensitivityLimit'], 'PATCH /projects/:id');

    const [projRows] = await pool.query(
      `SELECT companyId FROM ai_direct_projects WHERE id = ? LIMIT 1`,
      [id],
    );
    const project = (projRows as any[])[0];
    if (!project) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '项目不存在', 404);
    await requireCompanyRole(pool, project.companyId, user.id, 'manager');

    const updates: string[] = [];
    const params: unknown[] = [];

    if (body.name !== undefined) {
      updates.push('name = ?');
      params.push(readString(body.name, 'name', 160));
    }
    if (body.status !== undefined) {
      const status = readString(body.status, 'status', 32);
      if (!['active', 'inactive', 'archived'].includes(status)) {
        throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '无效的 status');
      }
      updates.push('status = ?');
      params.push(status);
    }
    if (body.budgetMicros !== undefined) {
      updates.push('budgetMicros = ?');
      params.push(BigInt(body.budgetMicros));
    }
    if (body.sensitivityLimit !== undefined) {
      updates.push('sensitivityLimit = ?');
      params.push(typeof body.sensitivityLimit === 'string' ? body.sensitivityLimit : null);
    }

    if (updates.length === 0) {
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '没有需要更新的字段');
    }

    params.push(id);
    await pool.query(`UPDATE ai_direct_projects SET ${updates.join(', ')}, updatedAt = NOW() WHERE id = ?`, params);

    const [rows] = await pool.query(
      `SELECT id, companyId, name, slug, status, budgetMicros, sensitivityLimit, createdAt, updatedAt
       FROM ai_direct_projects WHERE id = ?`,
      [id],
    );
    return (rows as any[])[0];
  });

  // DELETE /api/v1/ai-direct-hiring/projects/:id — delete project
  fastify.delete('/projects/:id', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const { id } = request.params;

    const [projRows] = await pool.query(
      `SELECT id, createdByUserId FROM ai_direct_projects WHERE id = ? LIMIT 1`,
      [id],
    );
    const project = (projRows as any[])[0];
    if (!project) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '项目不存在', 404);

    const [compRows] = await pool.query(
      `SELECT c.createdByUserId FROM ai_direct_projects p
       JOIN ai_direct_companies c ON c.id = p.companyId WHERE p.id = ? LIMIT 1`,
      [id],
    );
    const company = (compRows as any[])[0];
    if (company.createdByUserId !== user.id) {
      throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, '只有公司创建者可以删除项目', 403);
    }

    const reqId = requestIdFrom(request);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`DELETE FROM ai_direct_projects WHERE id = ?`, [id]);
      await writeAudit(conn, {
        organizationId: null,
        actorUserId: user.id,
        action: 'project.deleted',
        targetType: 'project',
        targetId: id,
        requestId: reqId,
      });
      await conn.commit();
      return reply.status(204).send();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  // ── Agent Roles ─────────────────────────────────────────────────────────────

  // GET /api/v1/ai-direct-hiring/projects/:id/roles — list roles for a project
  fastify.get('/projects/:id/roles', { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request);
    const { id } = request.params;

    const [projRows] = await pool.query(
      `SELECT companyId FROM ai_direct_projects WHERE id = ? LIMIT 1`,
      [id],
    );
    const project = (projRows as any[])[0];
    if (!project) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '项目不存在', 404);
    await requireCompanyRole(pool, project.companyId, user.id, 'member');

    const [rows] = await pool.query(
      `SELECT id, companyId, projectId, name, responsibilities, requiredCapabilities,
              budgetMicros, status, createdByUserId, createdAt, updatedAt
       FROM ai_direct_agent_roles
       WHERE projectId = ? OR (projectId IS NULL AND companyId = ?)
       ORDER BY createdAt DESC LIMIT 100`,
      [id, project.companyId],
    );
    return { items: rows };
  });

  // POST /api/v1/ai-direct-hiring/projects/:id/roles — create role
  fastify.post('/projects/:id/roles', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const { id } = request.params;
    const reqId = requestIdFrom(request);
    const body = readBody(request.body);
    rejectExtra(body, ['name', 'responsibilities', 'requiredCapabilities', 'budgetMicros'], 'POST /projects/:id/roles');

    const [projRows] = await pool.query(
      `SELECT companyId FROM ai_direct_projects WHERE id = ? LIMIT 1`,
      [id],
    );
    const project = (projRows as any[])[0];
    if (!project) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '项目不存在', 404);
    await requireCompanyRole(pool, project.companyId, user.id, 'member');

    const name = readString(body.name, 'name', 160);
    const responsibilities =
      body.responsibilities && typeof body.responsibilities === 'object'
        ? body.responsibilities
        : {};
    const requiredCapabilities =
      body.requiredCapabilities && typeof body.requiredCapabilities === 'object'
        ? body.requiredCapabilities
        : {};
    const budgetMicros =
      typeof body.budgetMicros === 'number' ? BigInt(body.budgetMicros) : BigInt(0);

    const roleId = randomUUID();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query(
        `INSERT INTO ai_direct_agent_roles
         (id, companyId, projectId, name, responsibilities, requiredCapabilities, budgetMicros, status, createdByUserId)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
        [
          roleId,
          project.companyId,
          id,
          name,
          JSON.stringify(responsibilities),
          JSON.stringify(requiredCapabilities),
          budgetMicros,
          user.id,
        ],
      );

      await writeAudit(conn, {
        organizationId: null,
        actorUserId: user.id,
        action: 'agent_role.created',
        targetType: 'agent_role',
        targetId: roleId,
        requestId: reqId,
        metadata: { projectId: id, name },
      });

      await publishOutboxEvent(conn, {
        organizationId: null,
        aggregateType: 'agent_role',
        aggregateId: roleId,
        eventType: 'agent_role.created.v1',
        payload: { id: roleId, projectId: id, name },
      });

      await conn.commit();
      return reply.status(201).send({ id: roleId, name, status: 'open' });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  // GET /api/v1/ai-direct-hiring/roles/:id — role detail
  fastify.get('/roles/:id', { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request);
    const { id } = request.params;

    const [rows] = await pool.query(
      `SELECT r.id, r.companyId, r.projectId, r.name, r.responsibilities, r.requiredCapabilities,
              r.budgetMicros, r.status, r.createdByUserId, r.createdAt, r.updatedAt
       FROM ai_direct_agent_roles r
       JOIN ai_direct_companies c ON c.id = r.companyId
       JOIN ai_direct_organization_members m ON m.organizationId = c.organizationId AND m.userId = ?
       WHERE r.id = ? LIMIT 1`,
      [user.id, id],
    );
    const role = (rows as any[])[0];
    if (!role) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '角色不存在', 404);
    return role;
  });

  // PATCH /api/v1/ai-direct-hiring/roles/:id — update role
  fastify.patch('/roles/:id', { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request);
    const { id } = request.params;
    const body = readBody(request.body ?? {});
    rejectExtra(body, ['name', 'status', 'responsibilities', 'requiredCapabilities', 'budgetMicros'], 'PATCH /roles/:id');

    const [roleRows] = await pool.query(
      `SELECT companyId FROM ai_direct_agent_roles WHERE id = ? LIMIT 1`,
      [id],
    );
    const role = (roleRows as any[])[0];
    if (!role) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '角色不存在', 404);
    await requireCompanyRole(pool, role.companyId, user.id, 'manager');

    const updates: string[] = [];
    const params: unknown[] = [];

    if (body.name !== undefined) {
      updates.push('name = ?');
      params.push(readString(body.name, 'name', 160));
    }
    if (body.status !== undefined) {
      const status = readString(body.status, 'status', 32);
      if (!['open', 'filled', 'cancelled'].includes(status)) {
        throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '无效的 status');
      }
      updates.push('status = ?');
      params.push(status);
    }
    if (body.responsibilities !== undefined) {
      updates.push('responsibilities = ?');
      params.push(JSON.stringify(body.responsibilities));
    }
    if (body.requiredCapabilities !== undefined) {
      updates.push('requiredCapabilities = ?');
      params.push(JSON.stringify(body.requiredCapabilities));
    }
    if (body.budgetMicros !== undefined) {
      updates.push('budgetMicros = ?');
      params.push(BigInt(body.budgetMicros));
    }

    if (updates.length === 0) {
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '没有需要更新的字段');
    }

    params.push(id);
    await pool.query(`UPDATE ai_direct_agent_roles SET ${updates.join(', ')}, updatedAt = NOW() WHERE id = ?`, params);

    const [rows] = await pool.query(
      `SELECT id, companyId, projectId, name, responsibilities, requiredCapabilities,
              budgetMicros, status, createdByUserId, createdAt, updatedAt
       FROM ai_direct_agent_roles WHERE id = ?`,
      [id],
    );
    return (rows as any[])[0];
  });

  // DELETE /api/v1/ai-direct-hiring/roles/:id — delete role
  fastify.delete('/roles/:id', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const { id } = request.params;

    const [roleRows] = await pool.query(
      `SELECT r.id, r.createdByUserId, c.createdByUserId AS companyCreator
       FROM ai_direct_agent_roles r
       JOIN ai_direct_companies c ON c.id = r.companyId WHERE r.id = ? LIMIT 1`,
      [id],
    );
    const role = (roleRows as any[])[0];
    if (!role) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '角色不存在', 404);

    if (role.createdByUserId !== user.id && role.companyCreator !== user.id) {
      throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, '只有创建者或公司创建者可删除角色', 403);
    }

    const reqId = requestIdFrom(request);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`DELETE FROM ai_direct_agent_roles WHERE id = ?`, [id]);
      await writeAudit(conn, {
        organizationId: null,
        actorUserId: user.id,
        action: 'agent_role.deleted',
        targetType: 'agent_role',
        targetId: id,
        requestId: reqId,
      });
      await conn.commit();
      return reply.status(204).send();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });
}
