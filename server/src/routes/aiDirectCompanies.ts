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
  companyRoles,
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

type ListCursor = { updatedAt: string; id: string };

function encodeCursor(row: { updatedAt: Date | string; id: string }): string {
  return Buffer.from(
    JSON.stringify({ updatedAt: new Date(row.updatedAt).toISOString(), id: row.id }),
    'utf8',
  ).toString('base64url');
}

function decodeCursor(value: unknown): ListCursor | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length > 512) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '无效的 cursor');
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as ListCursor;
    if (!parsed || typeof parsed.id !== 'string' || !parsed.id || Number.isNaN(Date.parse(parsed.updatedAt))) {
      throw new Error('invalid cursor');
    }
    return parsed;
  } catch {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '无效的 cursor');
  }
}

function readListQuery(query: Record<string, unknown>, statuses: readonly string[]) {
  const status = query.status === undefined ? undefined : readString(query.status, 'status', 32);
  if (status !== undefined && !statuses.includes(status)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '无效的 status filter');
  }
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'limit 必须为 1 到 100');
  }
  return { status, limit, cursor: decodeCursor(query.cursor) };
}

function permissionsFor(orgRole: string, companyRole?: string | null): string[] {
  const permissions = new Set<string>(['company.read', 'project.read', 'agent_role.read']);
  if (orgRole === 'owner' || orgRole === 'admin') {
    permissions.add('company.update');
    permissions.add('company.archive');
    permissions.add('company.members.manage');
  }
  if (['owner', 'admin'].includes(companyRole ?? '')) {
    permissions.add('company.update');
    permissions.add('company.archive');
    permissions.add('company.members.manage');
  }
  if (['owner', 'admin', 'manager'].includes(companyRole ?? '') || ['owner', 'admin', 'manager'].includes(orgRole)) {
    permissions.add('project.manage');
    permissions.add('agent_role.manage');
  }
  return [...permissions];
}

function readBudgetMicros(value: unknown): bigint {
  if (value === undefined) return 0n;
  if (
    (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) &&
    (typeof value !== 'string' || !/^\d+$/.test(value))
  ) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'budgetMicros 必须是非负整数');
  }
  const result = BigInt(value);
  if (result > 9_223_372_036_854_775_807n) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'budgetMicros 超出 BIGINT 范围');
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
    const { status, limit, cursor } = readListQuery(request.query ?? {}, ['active', 'inactive', 'archived']);
    const organizationId = request.query?.organizationId === undefined
      ? undefined
      : readString(request.query.organizationId, 'organizationId', 36);
    const conditions = [`m.userId = ?`, `m.status = 'active'`];
    const values: unknown[] = [user.id];
    if (organizationId) {
      conditions.push('c.organizationId = ?');
      values.push(organizationId);
    }
    if (status) {
      conditions.push('c.status = ?');
      values.push(status);
    }
    if (cursor) {
      conditions.push('(c.updatedAt < ? OR (c.updatedAt = ? AND c.id < ?))');
      values.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }
    values.push(limit + 1);
    const [rows] = await pool.query(
      `SELECT c.id, c.organizationId, c.name, c.slug, c.status, c.createdAt, c.updatedAt,
              m.role AS organizationRole, cm.role AS companyRole
       FROM ai_direct_companies c
       JOIN ai_direct_organization_members m
         ON m.organizationId = c.organizationId AND m.userId = ? AND m.status = 'active'
       LEFT JOIN ai_direct_company_members cm
         ON cm.companyId = c.id AND cm.userId = m.userId AND cm.status = 'active'
       WHERE ${conditions.slice(1).join(' AND ')}
       ORDER BY c.updatedAt DESC, c.id DESC LIMIT ?`,
      values,
    );
    const page = rows as any[];
    const hasMore = page.length > limit;
    const items = page.slice(0, limit).map((row) => ({
      ...row,
      permissions: permissionsFor(row.organizationRole, row.companyRole),
    }));
    return { items, nextCursor: hasMore && items.length ? encodeCursor(items[items.length - 1]) : null };
  });

  // POST /api/v1/ai-direct-hiring/companies — create company
  fastify.post('/companies', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const reqId = requestIdFrom(request);
    const body = readBody(request.body);
    rejectExtra(body, ['name', 'organizationId'], 'POST /companies');

    const name = readString(body.name, 'name', 160);
    const organizationId = readString(body.organizationId ?? '', 'organizationId', 36);

    // Company creation is an organization-management operation.
    const [orgRows] = await pool.query(
      `SELECT role FROM ai_direct_organization_members
       WHERE organizationId = ? AND userId = ? AND status = 'active' LIMIT 1`,
      [organizationId, user.id],
    );
    const organizationRole = (orgRows as any[])[0]?.role;
    if (organizationRole !== 'owner' && organizationRole !== 'admin') {
      throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, '需要组织 owner 或 admin 权限', 403);
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

      await conn.query(
        `INSERT INTO ai_direct_company_members (id, companyId, userId, role, status, createdAt, updatedAt)
         VALUES (?, ?, ?, 'owner', 'active', NOW(), NOW())`,
        [randomUUID(), companyId, user.id],
      );

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
    await requireCompanyRole(pool, id, user.id, 'recruiter');

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
      if (!['active', 'inactive'].includes(status)) {
        throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '公司 status 只能通过 PATCH 在 active/inactive 间切换；归档请使用 DELETE');
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
      const [companyRows] = await conn.query(
        `SELECT organizationId, status FROM ai_direct_companies WHERE id = ? LIMIT 1 FOR UPDATE`,
        [id],
      );
      const company = (companyRows as any[])[0];
      if (!company) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, '公司不存在', 404);
      if (company.status === 'archived') {
        throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, '已归档公司不能恢复或编辑', 409);
      }
      await conn.query(`UPDATE ai_direct_companies SET ${updates.join(', ')}, updatedAt = NOW() WHERE id = ?`, params);

      await writeAudit(conn, {
        organizationId: company.organizationId,
        actorUserId: user.id,
        action: 'company.updated',
        targetType: 'company',
        targetId: id,
        requestId: reqId,
        metadata: { updates: Object.keys(body), previousStatus: company.status },
      });
      await publishOutboxEvent(conn, {
        organizationId: company.organizationId,
        aggregateType: 'company',
        aggregateId: id,
        eventType: 'company.updated.v1',
        payload: { id, organizationId: company.organizationId, updates: Object.keys(body) },
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

  // DELETE keeps historical references intact by archiving an inactive company.
  fastify.delete('/companies/:id', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const { id } = request.params;
    await requireCompanyRole(pool, id, user.id, 'admin');

    const reqId = requestIdFrom(request);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query(
        `SELECT id, organizationId, status FROM ai_direct_companies WHERE id = ? LIMIT 1 FOR UPDATE`,
        [id],
      );
      const company = (rows as any[])[0];
      if (!company) {
        throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, '公司不存在', 404);
      }
      if (company.status === 'archived') {
        await conn.commit();
        return reply.status(200).send({ id, organizationId: company.organizationId, status: 'archived' });
      }
      if (company.status === 'active') {
        throw new AiDirectHiringError(
          ErrorCodes.INVALID_TRANSITION,
          '请先将公司停用，再执行归档',
          409,
        );
      }

      const [blockingRows] = await conn.query(
        `SELECT
           (SELECT COUNT(*) FROM ai_direct_projects WHERE companyId = ? AND status = 'active') AS activeProjects,
           (SELECT COUNT(*) FROM ai_direct_agent_roles WHERE companyId = ? AND status = 'open') AS openRoles,
           (SELECT COUNT(*) FROM ai_direct_offers WHERE companyId = ? AND status NOT IN ('accepted', 'rejected', 'expired', 'revoked')) AS activeOffers,
           (SELECT COUNT(*) FROM ai_direct_employments WHERE companyId = ? AND status <> 'terminated') AS activeEmployments`,
        [id, id, id, id],
      );
      const blockers = (blockingRows as any[])[0] ?? {};
      if (Object.values(blockers).some((value) => Number(value) > 0)) {
        throw new AiDirectHiringError(
          ErrorCodes.INVALID_TRANSITION,
          '公司仍有活跃项目、开放岗位、Offer 或在职 Employment，不能归档',
          409,
          { blockers },
        );
      }

      await conn.query(`UPDATE ai_direct_companies SET status = 'archived', updatedAt = NOW() WHERE id = ?`, [id]);
      await writeAudit(conn, {
        organizationId: company.organizationId,
        actorUserId: user.id,
        action: 'company.archived',
        targetType: 'company',
        targetId: id,
        requestId: reqId,
        metadata: { previousStatus: company.status },
      });
      await publishOutboxEvent(conn, {
        organizationId: company.organizationId,
        aggregateType: 'company',
        aggregateId: id,
        eventType: 'company.archived.v1',
        payload: { id, organizationId: company.organizationId, previousStatus: company.status },
      });
      await conn.commit();
      return reply.status(200).send({ id, organizationId: company.organizationId, status: 'archived' });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  fastify.get('/companies/:id/members', { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request);
    const companyId = readString(request.params.id, 'companyId', 36);
    const membership = await requireCompanyRole(pool, companyId, user.id, 'manager');
    const { status, limit, cursor } = readListQuery(request.query ?? {}, ['active', 'inactive']);
    const conditions = ['companyId = ?'];
    const values: unknown[] = [companyId];
    if (status) {
      conditions.push('status = ?');
      values.push(status);
    }
    if (cursor) {
      conditions.push('(updatedAt < ? OR (updatedAt = ? AND userId < ?))');
      values.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }
    values.push(limit + 1);
    const [rows] = await pool.query(
      `SELECT userId, role, status, createdAt, updatedAt
       FROM ai_direct_company_members WHERE ${conditions.join(' AND ')}
       ORDER BY updatedAt DESC, userId DESC LIMIT ?`,
      values,
    );
    const page = rows as any[];
    const hasMore = page.length > limit;
    const permissions = permissionsFor(membership.orgRole, membership.companyRole);
    const items = page.slice(0, limit).map((row) => ({ ...row, permissions }));
    const last = items[items.length - 1];
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor({ updatedAt: last.updatedAt, id: last.userId }) : null,
    };
  });

  fastify.put('/companies/:id/members/:userId', { onRequest: auth }, async (request: any) => {
    const actor = await requireAuth(fastify, request);
    const companyId = readString(request.params.id, 'companyId', 36);
    const targetUserId = readString(request.params.userId, 'userId', 191);
    const actorMembership = await requireCompanyRole(pool, companyId, actor.id, 'admin');
    const body = readBody(request.body);
    rejectExtra(body, ['role', 'status'], 'PUT /companies/:id/members/:userId');
    const role = readString(body.role, 'role', 32) as CompanyRole;
    const status = body.status === undefined ? 'active' : readString(body.status, 'status', 32);
    if (!companyRoles.includes(role) || !['active', 'inactive'].includes(status)) {
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '无效的 role 或 status');
    }
    if (role === 'owner' && actorMembership.companyRole !== 'owner') {
      throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, '只有 owner 可以授予 owner 角色', 403);
    }

    const reqId = requestIdFrom(request);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [companyRows] = await conn.query(
        `SELECT organizationId, status FROM ai_direct_companies WHERE id = ? LIMIT 1 FOR UPDATE`,
        [companyId],
      );
      const company = (companyRows as any[])[0];
      if (!company) {
        throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, '公司不存在', 404);
      }
      if (company.status !== 'active') {
        throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, '停用或归档公司不能新增或变更成员', 409);
      }
      const [orgRows] = await conn.query(
        `SELECT 1 FROM ai_direct_organization_members
         WHERE organizationId = ? AND userId = ? AND status = 'active' LIMIT 1`,
        [company.organizationId, targetUserId],
      );
      if (!(orgRows as any[]).length) {
        throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '目标用户必须先成为组织的活跃成员');
      }
      const [targetRows] = await conn.query(
        `SELECT role, status FROM ai_direct_company_members
         WHERE companyId = ? AND userId = ? LIMIT 1 FOR UPDATE`,
        [companyId, targetUserId],
      );
      const target = (targetRows as any[])[0];
      if (target?.role === 'owner' && actorMembership.companyRole !== 'owner') {
        throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, '只有 owner 可以变更 owner 成员', 403);
      }
      if (target?.role === 'owner' && (role !== 'owner' || status !== 'active')) {
        const [ownerRows] = await conn.query(
          `SELECT COUNT(*) AS count FROM ai_direct_company_members
           WHERE companyId = ? AND role = 'owner' AND status = 'active'`,
          [companyId],
        );
        if (Number((ownerRows as any[])[0]?.count ?? 0) <= 1) {
          throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, '公司必须至少保留一个活跃 owner', 409);
        }
      }
      await conn.query(
        `INSERT INTO ai_direct_company_members
         (id, companyId, userId, role, status, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE role = VALUES(role), status = VALUES(status), updatedAt = NOW()`,
        [randomUUID(), companyId, targetUserId, role, status],
      );
      await writeAudit(conn, {
        organizationId: company.organizationId,
        actorUserId: actor.id,
        action: target ? 'company.member.updated' : 'company.member.created',
        targetType: 'company_member',
        targetId: targetUserId,
        requestId: reqId,
        metadata: { companyId, role, status },
      });
      await publishOutboxEvent(conn, {
        organizationId: company.organizationId,
        aggregateType: 'company_member',
        aggregateId: targetUserId,
        eventType: 'company.member.upserted.v1',
        payload: { companyId, userId: targetUserId, role, status },
      });
      await conn.commit();
      return { companyId, userId: targetUserId, role, status };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  fastify.delete('/companies/:id/members/:userId', { onRequest: auth }, async (request: any, reply) => {
    const actor = await requireAuth(fastify, request);
    const companyId = readString(request.params.id, 'companyId', 36);
    const targetUserId = readString(request.params.userId, 'userId', 191);
    const actorMembership = await requireCompanyRole(pool, companyId, actor.id, 'admin');
    const reqId = requestIdFrom(request);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [companyRows] = await conn.query(
        `SELECT organizationId FROM ai_direct_companies WHERE id = ? LIMIT 1 FOR UPDATE`,
        [companyId],
      );
      const company = (companyRows as any[])[0];
      if (!company) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, '公司不存在', 404);
      const [targetRows] = await conn.query(
        `SELECT role, status FROM ai_direct_company_members
         WHERE companyId = ? AND userId = ? LIMIT 1 FOR UPDATE`,
        [companyId, targetUserId],
      );
      const target = (targetRows as any[])[0];
      if (!target || target.status !== 'active') {
        throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, '活跃公司成员不存在', 404);
      }
      if (target.role === 'owner' && actorMembership.companyRole !== 'owner') {
        throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, '只有 owner 可以撤销 owner 成员', 403);
      }
      if (target.role === 'owner') {
        const [ownerRows] = await conn.query(
          `SELECT COUNT(*) AS count FROM ai_direct_company_members
           WHERE companyId = ? AND role = 'owner' AND status = 'active'`,
          [companyId],
        );
        if (Number((ownerRows as any[])[0]?.count ?? 0) <= 1) {
          throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, '公司必须至少保留一个活跃 owner', 409);
        }
      }
      await conn.query(
        `UPDATE ai_direct_company_members SET status = 'inactive', updatedAt = NOW()
         WHERE companyId = ? AND userId = ?`,
        [companyId, targetUserId],
      );
      await writeAudit(conn, {
        organizationId: company.organizationId,
        actorUserId: actor.id,
        action: 'company.member.revoked',
        targetType: 'company_member',
        targetId: targetUserId,
        requestId: reqId,
        metadata: { companyId, previousRole: target.role },
      });
      await publishOutboxEvent(conn, {
        organizationId: company.organizationId,
        aggregateType: 'company_member',
        aggregateId: targetUserId,
        eventType: 'company.member.revoked.v1',
        payload: { companyId, organizationId: company.organizationId, userId: targetUserId },
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
    const { status, limit, cursor } = readListQuery(request.query ?? {}, ['active', 'inactive', 'archived']);
    const companyId = request.query?.companyId === undefined
      ? undefined
      : readString(request.query.companyId, 'companyId', 36);
    const conditions = [`m.userId = ?`, `m.status = 'active'`];
    const values: unknown[] = [user.id];
    if (companyId) {
      conditions.push('p.companyId = ?');
      values.push(companyId);
    }
    if (status) {
      conditions.push('p.status = ?');
      values.push(status);
    }
    if (cursor) {
      conditions.push('(p.updatedAt < ? OR (p.updatedAt = ? AND p.id < ?))');
      values.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }
    values.push(limit + 1);
    const [rows] = await pool.query(
      `SELECT p.id, p.companyId, p.name, p.slug, p.status, p.budgetMicros, p.sensitivityLimit,
              p.createdByUserId, p.createdAt, p.updatedAt, c.name AS companyName,
              m.role AS organizationRole, cm.role AS companyRole
       FROM ai_direct_projects p
       JOIN ai_direct_companies c ON c.id = p.companyId
       JOIN ai_direct_organization_members m
         ON m.organizationId = c.organizationId AND m.userId = ? AND m.status = 'active'
       LEFT JOIN ai_direct_company_members cm
         ON cm.companyId = c.id AND cm.userId = m.userId AND cm.status = 'active'
       WHERE ${conditions.slice(2).length ? conditions.slice(2).join(' AND ') : '1 = 1'}
       ORDER BY p.updatedAt DESC, p.id DESC LIMIT ?`,
      values,
    );
    const page = rows as any[];
    const hasMore = page.length > limit;
    const items = page.slice(0, limit).map((row) => ({
      ...row,
      permissions: permissionsFor(row.organizationRole, row.companyRole),
    }));
    return { items, nextCursor: hasMore && items.length ? encodeCursor(items[items.length - 1]) : null };
  });

  // POST /api/v1/ai-direct-hiring/projects — create project (needs company member)
  fastify.post('/projects', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const reqId = requestIdFrom(request);
    const body = readBody(request.body);
    rejectExtra(body, ['companyId', 'name', 'budgetMicros', 'sensitivityLimit'], 'POST /projects');

    const companyId = readString(body.companyId, 'companyId', 36);
    const name = readString(body.name, 'name', 160);
    await requireCompanyRole(pool, companyId, user.id, 'recruiter');
    const [companyStateRows] = await pool.query(
      `SELECT status, organizationId FROM ai_direct_companies WHERE id = ? LIMIT 1`,
      [companyId],
    );
    if ((companyStateRows as any[])[0]?.status !== 'active') {
      throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, '停用或归档公司不能创建项目', 409);
    }

    const projectId = randomUUID();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + projectId.slice(0, 8);
    const budgetMicros = readBudgetMicros(body.budgetMicros);
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
        organizationId: (companyStateRows as any[])[0].organizationId,
        actorUserId: user.id,
        action: 'project.created',
        targetType: 'project',
        targetId: projectId,
        requestId: reqId,
        metadata: { companyId, name, slug },
      });

      await publishOutboxEvent(conn, {
        organizationId: (companyStateRows as any[])[0].organizationId,
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
      params.push(readBudgetMicros(body.budgetMicros));
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
    const { status, limit, cursor } = readListQuery(request.query ?? {}, ['open', 'filled', 'cancelled']);

    const [projRows] = await pool.query(
      `SELECT companyId FROM ai_direct_projects WHERE id = ? LIMIT 1`,
      [id],
    );
    const project = (projRows as any[])[0];
    if (!project) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '项目不存在', 404);
    const membership = await requireCompanyRole(pool, project.companyId, user.id, 'recruiter');
    const conditions = ['(projectId = ? OR (projectId IS NULL AND companyId = ?))'];
    const values: unknown[] = [id, project.companyId];
    if (status) {
      conditions.push('status = ?');
      values.push(status);
    }
    if (cursor) {
      conditions.push('(updatedAt < ? OR (updatedAt = ? AND id < ?))');
      values.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }
    values.push(limit + 1);
    const [rows] = await pool.query(
      `SELECT id, companyId, projectId, name, responsibilities, requiredCapabilities,
              budgetMicros, status, createdByUserId, createdAt, updatedAt
       FROM ai_direct_agent_roles
       WHERE ${conditions.join(' AND ')}
       ORDER BY updatedAt DESC, id DESC LIMIT ?`,
      values,
    );
    const page = rows as any[];
    const hasMore = page.length > limit;
    const permissions = permissionsFor(membership.orgRole, membership.companyRole);
    const items = page.slice(0, limit).map((row) => ({ ...row, permissions }));
    return { items, nextCursor: hasMore && items.length ? encodeCursor(items[items.length - 1]) : null };
  });

  // POST /api/v1/ai-direct-hiring/projects/:id/roles — create role
  fastify.post('/projects/:id/roles', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const { id } = request.params;
    const reqId = requestIdFrom(request);
    const body = readBody(request.body);
    rejectExtra(body, ['name', 'responsibilities', 'requiredCapabilities', 'budgetMicros'], 'POST /projects/:id/roles');

    const [projRows] = await pool.query(
      `SELECT p.companyId, p.status AS projectStatus, c.status AS companyStatus, c.organizationId
       FROM ai_direct_projects p JOIN ai_direct_companies c ON c.id = p.companyId
       WHERE p.id = ? LIMIT 1`,
      [id],
    );
    const project = (projRows as any[])[0];
    if (!project) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '项目不存在', 404);
    await requireCompanyRole(pool, project.companyId, user.id, 'recruiter');
    if (project.projectStatus !== 'active' || project.companyStatus !== 'active') {
      throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, '停用项目或公司不能创建岗位', 409);
    }

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
      readBudgetMicros(body.budgetMicros);

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
        organizationId: project.organizationId,
        actorUserId: user.id,
        action: 'agent_role.created',
        targetType: 'agent_role',
        targetId: roleId,
        requestId: reqId,
        metadata: { projectId: id, name },
      });

      await publishOutboxEvent(conn, {
        organizationId: project.organizationId,
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
      params.push(readBudgetMicros(body.budgetMicros));
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
