/**
 * AI Direct Hiring — Employments routes (P2).
 *
 * Endpoints:
 *   GET  /api/v1/ai-direct-hiring/employments                    — list employments
 *   POST /api/v1/ai-direct-hiring/employments                    — create employment
 *   GET  /api/v1/ai-direct-hiring/employments/:id               — employment detail
 *   POST /api/v1/ai-direct-hiring/employments/:id/transition     — state machine transition
 *   GET  /api/v1/ai-direct-hiring/employments/:id/events        — event log
 */

import { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { AiDirectHiringError, ErrorCodes } from '../services/aiDirectErrors.js';
import { publishOutboxEvent } from '../utils/outbox.js';
import { requireAuth } from '../middleware/aiDirectAuth.js';
import { requireCompanyRole, requireEmploymentScope } from '../middleware/aiDirectRbac.js';
import {
  transitionEmployment,
  type EmploymentStatus,
} from '../services/employmentStateMachine.js';

// ─── Helpers ───────────────────────────────────────────────────────────────────

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

async function advanceEmploymentStatus(
  conn: any,
  employment: any,
  toStatus: EmploymentStatus,
  event: string,
  actorUserId: string,
  reqId: string,
  approvalId?: string | null,
  extra?: Record<string, unknown>,
): Promise<any> {
  const transition = transitionEmployment(
    employment.status as EmploymentStatus,
    toStatus,
    event,
  );

  await synchronizeAppearanceControl(
    conn,
    employment,
    transition.from,
    transition.to,
    actorUserId,
    reqId,
  );

  const updateFields: string[] = ['status = ?', 'updatedAt = NOW()'];
  const updateParams: unknown[] = [toStatus];

  if (toStatus === 'active' && !employment.startedAt) {
    updateFields.push('startedAt = NOW()');
  }
  if (toStatus === 'terminated') {
    updateFields.push('endedAt = NOW()');
  }

  const updateQuery = `UPDATE ai_direct_employments SET ${updateFields.join(', ')} WHERE id = ?`;
  await conn.query(updateQuery, [...updateParams, employment.id]);

  // Get next sequence for employment events
  const [seqRows] = await conn.query(
    `SELECT COALESCE(MAX(sequence), 0) + 1 AS nextSeq
     FROM ai_direct_employment_events WHERE employmentId = ? FOR UPDATE`,
    [employment.id],
  );
  const nextSeq = (seqRows as any[])[0]?.nextSeq ?? 1;

  await conn.query(
    `INSERT INTO ai_direct_employment_events
     (id, employmentId, sequence, fromStatus, toStatus, actorUserId, approvalId, reason, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      employment.id,
      nextSeq,
      transition.from,
      transition.to,
      actorUserId,
      approvalId ?? null,
      (extra?.reason as string) ?? null,
      extra ? JSON.stringify(extra) : null,
    ],
  );

  await writeAudit(conn, {
    organizationId: null,
    actorUserId,
    action: `employment.${event}`,
    targetType: 'employment',
    targetId: employment.id,
    requestId: reqId,
    metadata: { from: transition.from, to: transition.to, ...extra },
  });

  await publishOutboxEvent(conn, {
    organizationId: null,
    aggregateType: 'employment',
    aggregateId: employment.id,
    eventType: `employment.${event}.v1`,
    payload: {
      employmentId: employment.id,
      companyId: employment.companyId,
      agentId: employment.agentId,
      roleId: employment.roleId,
      from: transition.from,
      to: transition.to,
      actorUserId,
      ...extra,
    },
  });

  // Read through the transaction connection so the response reflects the transition.
  const [rows] = await conn.query(
    `SELECT e.*, r.name AS roleName, c.name AS companyName
     FROM ai_direct_employments e
     JOIN ai_direct_agent_roles r ON r.id = e.roleId
     JOIN ai_direct_companies c ON c.id = e.companyId
     WHERE e.id = ? LIMIT 1`,
    [employment.id],
  );
  return (rows as any[])[0];
}

async function synchronizeAppearanceControl(
  conn: any,
  employment: any,
  fromStatus: EmploymentStatus,
  toStatus: EmploymentStatus,
  actorUserId: string,
  reqId: string,
): Promise<void> {
  if (toStatus !== 'accepted' && toStatus !== 'terminated') return;

  // Locking the Agent serializes competing Employments even when no profile row exists yet.
  const [agentRows] = await conn.query(
    `SELECT id, ownerUserId FROM ai_direct_agents WHERE id = ? LIMIT 1 FOR UPDATE`,
    [employment.agentId],
  );
  const agent = (agentRows as any[])[0];
  if (!agent) {
    throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, 'Employment 对应的 Agent 不存在', 404);
  }
  const [profileRows] = await conn.query(
    `SELECT controllerEmploymentId, controllerCompanyId, revision
     FROM ai_direct_agent_appearance_profiles
     WHERE agentId = ? LIMIT 1 FOR UPDATE`,
    [employment.agentId],
  );
  const profile = (profileRows as any[])[0];

  if (toStatus === 'accepted') {
    if (profile?.controllerEmploymentId && profile.controllerEmploymentId !== employment.id) {
      throw new AiDirectHiringError(
        ErrorCodes.APPEARANCE_CONTROL_CONFLICT,
        '该 Agent 的形象控制权已由另一 Employment 持有',
        409,
        {
          agentId: employment.agentId,
          controllerEmploymentId: profile.controllerEmploymentId,
          controllerCompanyId: profile.controllerCompanyId,
        },
      );
    }
    if (!profile) {
      await conn.query(
        `INSERT INTO ai_direct_agent_appearance_profiles
           (agentId, avatarAssetId, defaultMode, controllerEmploymentId, controllerCompanyId,
            revision, updatedByUserId, createdAt, updatedAt)
         VALUES (?, NULL, 'image_2d', ?, ?, 1, ?, NOW(3), NOW(3))`,
        [employment.agentId, employment.id, employment.companyId, actorUserId],
      );
    } else if (!profile.controllerEmploymentId) {
      await conn.query(
        `UPDATE ai_direct_agent_appearance_profiles
         SET controllerEmploymentId = ?, controllerCompanyId = ?, revision = revision + 1,
             updatedByUserId = ?, updatedAt = NOW(3)
         WHERE agentId = ?`,
        [employment.id, employment.companyId, actorUserId, employment.agentId],
      );
    } else {
      return;
    }
  } else {
    if (!profile || profile.controllerEmploymentId !== employment.id) return;
    await conn.query(
      `UPDATE ai_direct_agent_appearance_profiles
       SET controllerEmploymentId = NULL, controllerCompanyId = NULL, revision = revision + 1,
           updatedByUserId = ?, updatedAt = NOW(3)
       WHERE agentId = ? AND controllerEmploymentId = ?`,
      [actorUserId, employment.agentId, employment.id],
    );
  }

  const action = toStatus === 'accepted'
    ? 'agent_appearance.control.transferred.v1'
    : 'agent_appearance.control.released.v1';
  await writeAudit(conn, {
    organizationId: null,
    actorUserId,
    action,
    targetType: 'agent_appearance',
    targetId: employment.agentId,
    requestId: reqId,
    metadata: {
      employmentId: employment.id,
      companyId: employment.companyId,
      fromStatus,
      toStatus,
    },
  });
  await publishOutboxEvent(conn, {
    organizationId: null,
    aggregateType: 'agent_appearance',
    aggregateId: employment.agentId,
    eventType: toStatus === 'accepted'
      ? 'agent_appearance.control.transferred.v1'
      : 'agent_appearance.control.released.v1',
    payload: {
      agentId: employment.agentId,
      employmentId: employment.id,
      companyId: employment.companyId,
      actorUserId,
    },
  });
}

// ─── Routes ────────────────────────────────────────────────────────────────────

export async function aiDirectEmploymentsRoutes(fastify: FastifyInstance) {
  const pool = (fastify as any).mysql as any;
  const auth = [(fastify as any).authenticate];

  // GET /api/v1/ai-direct-hiring/employments — list employments
  fastify.get('/employments', { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request);
    const status = typeof request.query?.status === 'string' ? request.query.status : null;

    let sql = `
      SELECT e.id, e.companyId, e.agentId, e.agentVersionId, e.roleId, e.projectId,
             e.offerId, e.status, e.startedAt, e.endedAt, e.createdAt, e.updatedAt,
             r.name AS roleName, c.name AS companyName,
             c.organizationId
      FROM ai_direct_employments e
      JOIN ai_direct_agent_roles r ON r.id = e.roleId
      JOIN ai_direct_companies c ON c.id = e.companyId
      WHERE (
        e.agentId IN (
          SELECT ownerUserId FROM ai_direct_agents WHERE ownerUserId = ?
        )
        OR c.organizationId IN (
          SELECT organizationId FROM ai_direct_organization_members WHERE userId = ? AND status = 'active'
        )
      )`;
    const params: unknown[] = [user.id, user.id];

    if (status) {
      sql += ` AND e.status = ?`;
      params.push(status);
    }
    sql += ` ORDER BY e.updatedAt DESC LIMIT 100`;

    const [rows] = await pool.query(sql, params);
    return { items: rows };
  });

  // POST /api/v1/ai-direct-hiring/employments — create from accepted offer
  fastify.post('/employments', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const reqId = requestIdFrom(request);
    const body = readBody(request.body);
    rejectExtra(body, ['offerId'], 'POST /employments');

    const offerId = readString(body.offerId, 'offerId', 36);

    // Fetch the accepted offer
    const [offerRows] = await pool.query(
      `SELECT o.*, r.name AS roleName, c.name AS companyName
       FROM ai_direct_offers o
       JOIN ai_direct_agent_roles r ON r.id = o.roleId
       JOIN ai_direct_companies c ON c.id = o.companyId
       WHERE o.id = ? LIMIT 1`,
      [offerId],
    );
    const offer = (offerRows as any[])[0];
    if (!offer) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'Offer 不存在', 404);
    if (offer.status !== 'accepted') {
      throw new AiDirectHiringError(
        ErrorCodes.VALIDATION_ERROR,
        `只能基于 accepted 状态的 Offer 创建 Employment，当前状态: '${offer.status}'`,
        409,
      );
    }
    const [existingRows] = await pool.query(
      `SELECT id FROM ai_direct_employments WHERE offerId = ? LIMIT 1`,
      [offerId],
    );
    if ((existingRows as any[]).length) {
      throw new AiDirectHiringError(
        ErrorCodes.DUPLICATE_ENTRY,
        '该 Offer 已创建 Employment',
        409,
      );
    }

    // Get agent info from agentVersionId
    const [versionRows] = await pool.query(
      `SELECT agentId FROM ai_direct_agent_versions WHERE id = ? LIMIT 1`,
      [offer.agentVersionId],
    );
    const version = (versionRows as any[])[0];
    if (!version) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'Agent 版本不存在', 404);

    const employmentId = randomUUID();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query(
        `INSERT INTO ai_direct_employments
         (id, companyId, agentId, agentVersionId, roleId, projectId, offerId, requestedByUserId, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'candidate')`,
        [
          employmentId,
          offer.companyId,
          version.agentId,
          offer.agentVersionId,
          offer.roleId,
          offer.projectId,
          offerId,
          user.id,
        ],
      );

      // Record initial event
      await conn.query(
        `INSERT INTO ai_direct_employment_events
         (id, employmentId, sequence, fromStatus, toStatus, actorUserId, reason, metadata)
         VALUES (?, ?, 1, NULL, 'candidate', ?, ?, ?)`,
        [
          randomUUID(),
          employmentId,
          user.id,
          'Employment created from accepted offer',
          JSON.stringify({ offerId }),
        ],
      );

      await writeAudit(conn, {
        organizationId: null,
        actorUserId: user.id,
        action: 'employment.created',
        targetType: 'employment',
        targetId: employmentId,
        requestId: reqId,
        metadata: { offerId, companyId: offer.companyId },
      });

      await publishOutboxEvent(conn, {
        organizationId: null,
        aggregateType: 'employment',
        aggregateId: employmentId,
        eventType: 'employment.created.v1',
        payload: { employmentId, offerId, companyId: offer.companyId },
      });

      await conn.commit();
      return reply.status(201).send({ id: employmentId, status: 'candidate' });
    } catch (err) {
      await conn.rollback();
      if ((err as { code?: string })?.code === 'ER_DUP_ENTRY') {
        throw new AiDirectHiringError(
          ErrorCodes.DUPLICATE_ENTRY,
          '该 Offer 已创建 Employment',
          409,
        );
      }
      throw err;
    } finally {
      conn.release();
    }
  });

  // GET /api/v1/ai-direct-hiring/employments/:id — employment detail
  fastify.get('/employments/:id', { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request);
    const { id } = request.params;
    await requireEmploymentScope(pool, id, user.id);

    const [rows] = await pool.query(
      `SELECT e.id, e.companyId, e.agentId, e.agentVersionId, e.roleId, e.projectId,
              e.offerId, e.status, e.startedAt, e.endedAt, e.createdAt, e.updatedAt,
              r.name AS roleName, c.name AS companyName
       FROM ai_direct_employments e
       JOIN ai_direct_agent_roles r ON r.id = e.roleId
       JOIN ai_direct_companies c ON c.id = e.companyId
       WHERE e.id = ? LIMIT 1`,
      [id],
    );
    const employment = (rows as any[])[0];
    if (!employment) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'Employment 不存在', 404);
    return employment;
  });

  // POST /api/v1/ai-direct-hiring/employments/:id/transition — explicit state machine transition
  fastify.post('/employments/:id/transition', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const reqId = requestIdFrom(request);
    const { id } = request.params;
    const body = readBody(request.body ?? {});
    rejectExtra(body, ['toStatus', 'reason', 'approvalId'], 'POST /employments/:id/transition');

    const toStatus = readString(body.toStatus, 'toStatus', 32);
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : null;
    const approvalId =
      typeof body.approvalId === 'string' && body.approvalId.length > 0
        ? body.approvalId
        : null;

    // Validate target status is a known EmploymentStatus
    const validStatuses = ['candidate', 'evaluating', 'offer_pending', 'offered', 'accepted', 'onboarding', 'active', 'paused', 'offboarding', 'terminated'];
    if (!validStatuses.includes(toStatus)) {
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `无效的 toStatus: ${toStatus}`);
    }

    // Authorization is checked before acquiring a connection; state validation is repeated under lock.
    await requireEmploymentScope(pool, id, user.id);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [lockedRows] = await conn.query(
        `SELECT id, companyId, requestedByUserId, agentId, agentVersionId, roleId,
                projectId, offerId, status, startedAt, endedAt
         FROM ai_direct_employments WHERE id = ? LIMIT 1 FOR UPDATE`,
        [id],
      );
      const employment = (lockedRows as any[])[0];
      if (!employment) {
        throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, 'Employment 不存在', 404);
      }
      const updated = await advanceEmploymentStatus(
        conn, employment, toStatus as EmploymentStatus, 'transition',
        user.id, reqId, approvalId, { reason },
      );
      await conn.commit();
      return reply.status(200).send(updated);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  // GET /api/v1/ai-direct-hiring/employments/:id/events — event log
  fastify.get('/employments/:id/events', { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request);
    const { id } = request.params;
    await requireEmploymentScope(pool, id, user.id);

    const [rows] = await pool.query(
      `SELECT id, employmentId, sequence, fromStatus, toStatus, actorUserId,
              approvalId, reason, metadata, occurredAt
       FROM ai_direct_employment_events
       WHERE employmentId = ?
       ORDER BY sequence ASC LIMIT 200`,
      [id],
    );
    return { items: rows };
  });
}
