import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/aiDirectAuth.js';
import { AiDirectHiringError, ErrorCodes } from '../services/aiDirectErrors.js';
import {
  extractRequestId,
  idempotencyFingerprint,
  parseIdempotencyKey,
} from '../utils/idempotency.js';
import { publishOutboxEvent } from '../utils/outbox.js';

const organizationRoles = ['owner', 'admin', 'manager', 'member'] as const;
type OrganizationRole = (typeof organizationRoles)[number];

const readBody = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '请求体必须是对象');
  }
  return value as Record<string, unknown>;
};

const readString = (value: unknown, field: string, maxLength: number): string => {
  if (typeof value !== 'string') {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 必须是字符串`);
  }
  const result = value.trim();
  if (!result || result.length > maxLength) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 长度必须为 1 到 ${maxLength}`);
  }
  return result;
};

const slugify = (name: string, id: string): string => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'organization';
  return `${base}-${id.slice(0, 8)}`;
};

const writeAudit = async (
  connection: { query(sql: string, values?: unknown[]): Promise<unknown> },
  input: {
    organizationId: string;
    actorUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    requestId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> => {
  await connection.query(
    `INSERT INTO ai_direct_audit_events
     (id, organizationId, actorUserId, action, targetType, targetId, requestId, outcome, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'success', ?)`,
    [
      randomUUID(),
      input.organizationId,
      input.actorUserId,
      input.action,
      input.targetType,
      input.targetId,
      input.requestId,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );
};

const requireOrganizationAdmin = async (
  pool: any,
  organizationId: string,
  userId: string,
): Promise<OrganizationRole> => {
  const [rows] = await pool.query(
    `SELECT role FROM ai_direct_organization_members
     WHERE organizationId = ? AND userId = ? AND status = 'active' LIMIT 1`,
    [organizationId, userId],
  );
  const role = (rows as Array<{ role: OrganizationRole }>)[0]?.role;
  if (role !== 'owner' && role !== 'admin') {
    throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, '需要组织 owner 或 admin 权限', 403);
  }
  return role;
};

export async function aiDirectOrganizationsRoutes(fastify: FastifyInstance): Promise<void> {
  const pool = (fastify as any).mysql as any;
  const auth = [(fastify as any).authenticate];

  fastify.get('/organizations', { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request);
    const [rows] = await pool.query(
      `SELECT o.id, o.name, o.slug, o.status, m.role, o.createdAt, o.updatedAt
       FROM ai_direct_organizations o
       JOIN ai_direct_organization_members m ON m.organizationId = o.id
       WHERE m.userId = ? AND m.status = 'active'
       ORDER BY o.updatedAt DESC LIMIT 100`,
      [user.id],
    );
    return { items: rows };
  });

  fastify.post('/organizations', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const body = readBody(request.body);
    const extra = Object.keys(body).filter((key) => key !== 'name');
    if (extra.length) {
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `不接受以下字段: ${extra.join(', ')}`);
    }
    const name = readString(body.name, 'name', 160);
    const key = parseIdempotencyKey(request);
    const fingerprint = idempotencyFingerprint({ name });

    if (key) {
      const [existingRows] = await pool.query(
        `SELECT id, name, slug, status, idempotencyFingerprint
         FROM ai_direct_organizations WHERE ownerUserId = ? AND idempotencyKey = ? LIMIT 1`,
        [user.id, key],
      );
      const existing = (existingRows as any[])[0];
      if (existing) {
        if (existing.idempotencyFingerprint !== fingerprint) {
          throw new AiDirectHiringError(ErrorCodes.IDEMPOTENCY_KEY_REUSED, '幂等键已用于不同的组织创建请求', 409);
        }
        return reply.status(200).send({ ...existing, idempotencyFingerprint: undefined, replayed: true });
      }
    }

    const organizationId = randomUUID();
    const slug = slugify(name, organizationId);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        `INSERT INTO ai_direct_organizations
         (id, name, slug, ownerUserId, idempotencyKey, idempotencyFingerprint, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')`,
        [organizationId, name, slug, user.id, key, key ? fingerprint : null],
      );
      await connection.query(
        `INSERT INTO ai_direct_organization_members
         (id, organizationId, userId, role, status, createdByUserId)
         VALUES (?, ?, ?, 'owner', 'active', ?)`,
        [randomUUID(), organizationId, user.id, user.id],
      );
      await writeAudit(connection, {
        organizationId,
        actorUserId: user.id,
        action: 'organization.created',
        targetType: 'organization',
        targetId: organizationId,
        requestId: extractRequestId(request),
        metadata: { name, slug },
      });
      await publishOutboxEvent(connection, {
        organizationId,
        aggregateType: 'organization',
        aggregateId: organizationId,
        eventType: 'organization.created.v1',
        payload: { organizationId, name, slug, ownerUserId: user.id },
      });
      await connection.commit();
      return reply.status(201).send({ id: organizationId, name, slug, status: 'active', role: 'owner' });
    } catch (error) {
      await connection.rollback();
      if ((error as any)?.code === 'ER_DUP_ENTRY') {
        throw new AiDirectHiringError(ErrorCodes.DUPLICATE_ENTRY, '组织标识或幂等键已存在', 409);
      }
      throw error;
    } finally {
      connection.release();
    }
  });

  fastify.get('/organizations/:id/members', { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request);
    await requireOrganizationAdmin(pool, request.params.id, user.id);
    const [rows] = await pool.query(
      `SELECT userId, role, status, createdByUserId, createdAt, updatedAt
       FROM ai_direct_organization_members WHERE organizationId = ?
       ORDER BY createdAt ASC LIMIT 500`,
      [request.params.id],
    );
    return { items: rows };
  });

  fastify.put('/organizations/:id/members/:userId', { onRequest: auth }, async (request: any) => {
    const actor = await requireAuth(fastify, request);
    const organizationId = readString(request.params.id, 'organizationId', 36);
    const targetUserId = readString(request.params.userId, 'userId', 191);
    const actorRole = await requireOrganizationAdmin(pool, organizationId, actor.id);
    const body = readBody(request.body);
    const role = readString(body.role, 'role', 32) as OrganizationRole;
    const status = body.status === undefined ? 'active' : readString(body.status, 'status', 32);
    if (!organizationRoles.includes(role) || !['active', 'inactive'].includes(status)) {
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '无效的 role 或 status');
    }
    if (role === 'owner' && actorRole !== 'owner') {
      throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, '只有 owner 可以授予 owner 角色', 403);
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [targetRows] = await connection.query(
        `SELECT role, status FROM ai_direct_organization_members
         WHERE organizationId = ? AND userId = ? LIMIT 1 FOR UPDATE`,
        [organizationId, targetUserId],
      );
      const target = (targetRows as any[])[0];
      if (target?.role === 'owner' && (role !== 'owner' || status !== 'active')) {
        const [ownerRows] = await connection.query(
          `SELECT COUNT(*) AS count FROM ai_direct_organization_members
           WHERE organizationId = ? AND role = 'owner' AND status = 'active'`,
          [organizationId],
        );
        if (Number((ownerRows as any[])[0]?.count ?? 0) <= 1) {
          throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, '组织必须至少保留一个活跃 owner', 409);
        }
      }
      await connection.query(
        `INSERT INTO ai_direct_organization_members
         (id, organizationId, userId, role, status, createdByUserId)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE role = VALUES(role), status = VALUES(status), updatedAt = NOW()`,
        [randomUUID(), organizationId, targetUserId, role, status, actor.id],
      );
      await writeAudit(connection, {
        organizationId,
        actorUserId: actor.id,
        action: target ? 'organization.member.updated' : 'organization.member.created',
        targetType: 'organization_member',
        targetId: targetUserId,
        requestId: extractRequestId(request),
        metadata: { role, status },
      });
      await publishOutboxEvent(connection, {
        organizationId,
        aggregateType: 'organization_member',
        aggregateId: targetUserId,
        eventType: 'organization.member.upserted.v1',
        payload: { organizationId, userId: targetUserId, role, status },
      });
      await connection.commit();
      return { organizationId, userId: targetUserId, role, status };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });
}