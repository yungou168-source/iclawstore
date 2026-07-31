/**
 * AI Direct Hiring — Offers routes (P2).
 *
 * Endpoints:
 *   GET  /api/v1/ai-direct-hiring/offers                    — list offers
 *   POST /api/v1/ai-direct-hiring/offers                    — create offer (draft)
 *   POST /api/v1/ai-direct-hiring/offers/:id/submit         — submit for approval
 *   POST /api/v1/ai-direct-hiring/offers/:id/approve        — approve
 *   POST /api/v1/ai-direct-hiring/offers/:id/reject          — reject
 *   POST /api/v1/ai-direct-hiring/offers/:id/send            — send to candidate
 *   POST /api/v1/ai-direct-hiring/offers/:id/accept         — candidate accepts
 *   POST /api/v1/ai-direct-hiring/offers/:id/decline         — candidate declines
 *   POST /api/v1/ai-direct-hiring/offers/:id/revoke          — revoke
 *   POST /api/v1/ai-direct-hiring/offers/:id/expire         — mark expired
 */

import { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { AiDirectHiringError, ErrorCodes, errorResponse } from '../services/aiDirectErrors.js';
import { publishOutboxEvent } from '../utils/outbox.js';
import { requireAuth } from '../middleware/aiDirectAuth.js';
import { requireCompanyRole } from '../middleware/aiDirectRbac.js';
import {
  transitionOffer,
  isOfferTerminal,
  type OfferStatus,
} from '../services/offerStateMachine.js';

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

async function fetchOffer(
  pool: any,
  offerId: string,
): Promise<any> {
  const [rows] = await pool.query(
    `SELECT o.*, r.name AS roleName, c.name AS companyName
     FROM ai_direct_offers o
     JOIN ai_direct_agent_roles r ON r.id = o.roleId
     JOIN ai_direct_companies c ON c.id = o.companyId
     WHERE o.id = ? LIMIT 1`,
    [offerId],
  );
  return (rows as any[])[0];
}

async function advanceOfferStatus(
  conn: any,
  pool: any,
  offer: any,
  toStatus: OfferStatus,
  event: string,
  actorUserId: string,
  reqId: string,
  extra?: Record<string, unknown>,
): Promise<any> {
  const transition = transitionOffer(offer.status as OfferStatus, toStatus, event);

  const updateFields: string[] = ['status = ?', 'updatedAt = NOW()'];
  const updateParams: unknown[] = [toStatus];

  if (event === 'sent' && offer.expiresAt) {
    updateFields.push('expiresAt = ?');
    updateParams.push(offer.expiresAt);
  }
  if (event === 'accepted') {
    updateFields.push('acceptedAt = NOW()');
  }
  if (event === 'rejected') {
    updateFields.push('rejectedAt = NOW()');
  }

  const updateQuery = `UPDATE ai_direct_offers SET ${updateFields.join(', ')} WHERE id = ?`;
  await conn.query(updateQuery, [...updateParams, offer.id]);

  await writeAudit(conn, {
    organizationId: null,
    actorUserId,
    action: `offer.${event}`,
    targetType: 'offer',
    targetId: offer.id,
    requestId: reqId,
    metadata: { from: transition.from, to: transition.to, ...extra },
  });

  await publishOutboxEvent(conn, {
    organizationId: null,
    aggregateType: 'offer',
    aggregateId: offer.id,
    eventType: `offer.${event}.v1`,
    payload: {
      offerId: offer.id,
      roleId: offer.roleId,
      agentVersionId: offer.agentVersionId,
      companyId: offer.companyId,
      from: transition.from,
      to: transition.to,
      actorUserId,
      ...extra,
    },
  });

  await conn.commit();

  // Refetch after commit
  const [rows] = await pool.query(
    `SELECT o.*, r.name AS roleName, c.name AS companyName
     FROM ai_direct_offers o
     JOIN ai_direct_agent_roles r ON r.id = o.roleId
     JOIN ai_direct_companies c ON c.id = o.companyId
     WHERE o.id = ? LIMIT 1`,
    [offer.id],
  );
  return (rows as any[])[0];
}

// ─── Routes ────────────────────────────────────────────────────────────────────

export async function aiDirectOffersRoutes(fastify: FastifyInstance) {
  const pool = (fastify as any).mysql as any;
  const auth = [(fastify as any).authenticate];

  // GET /api/v1/ai-direct-hiring/offers — list offers (mine + my company)
  fastify.get('/offers', { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request);
    const status = typeof request.query?.status === 'string' ? request.query.status : null;

    let sql = `
      SELECT o.id, o.roleId, o.agentVersionId, o.companyId, o.projectId, o.status,
             o.terms, o.approvalId, o.proposedByUserId, o.proposedAt,
             o.expiresAt, o.acceptedAt, o.rejectedAt, o.rejectedReason,
             o.createdAt, o.updatedAt,
             r.name AS roleName, c.name AS companyName
      FROM ai_direct_offers o
      JOIN ai_direct_agent_roles r ON r.id = o.roleId
      JOIN ai_direct_companies c ON c.id = o.companyId
      WHERE (
        o.proposedByUserId = ?
        OR c.organizationId IN (
          SELECT organizationId FROM ai_direct_organization_members WHERE userId = ? AND status = 'active'
        )
      )`;
    const params: unknown[] = [user.id, user.id];

    if (status) {
      sql += ` AND o.status = ?`;
      params.push(status);
    }
    sql += ` ORDER BY o.updatedAt DESC LIMIT 100`;

    const [rows] = await pool.query(sql, params);
    return { items: rows };
  });

  // POST /api/v1/ai-direct-hiring/offers — create offer (draft)
  fastify.post('/offers', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const reqId = requestIdFrom(request);
    const body = readBody(request.body);
    rejectExtra(body, ['roleId', 'agentVersionId', 'companyId', 'projectId', 'terms', 'expiresAt'], 'POST /offers');

    const roleId = readString(body.roleId, 'roleId', 36);
    const agentVersionId = readString(body.agentVersionId, 'agentVersionId', 36);
    const companyId = readString(body.companyId, 'companyId', 36);
    const projectId =
      typeof body.projectId === 'string' && body.projectId.length > 0
        ? readString(body.projectId, 'projectId', 36)
        : null;
    const terms =
      body.terms && typeof body.terms === 'object' ? body.terms : {};
    const expiresAt =
      typeof body.expiresAt === 'string' && body.expiresAt.length > 0
        ? new Date(body.expiresAt)
        : null;

    // Verify role and company access
    await requireCompanyRole(pool, companyId, user.id, 'recruiter');

    const [roleRows] = await pool.query(
      `SELECT id FROM ai_direct_agent_roles WHERE id = ? AND companyId = ? LIMIT 1`,
      [roleId, companyId],
    );
    if (!(roleRows as any[]).length) {
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '角色不存在或不属于该公司');
    }

    const offerId = randomUUID();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query(
        `INSERT INTO ai_direct_offers
         (id, roleId, agentVersionId, companyId, projectId, status, terms,
          proposedByUserId, proposedAt, expiresAt)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, NOW(), ?)`,
        [offerId, roleId, agentVersionId, companyId, projectId, JSON.stringify(terms), user.id, expiresAt],
      );

      await writeAudit(conn, {
        organizationId: null,
        actorUserId: user.id,
        action: 'offer.created',
        targetType: 'offer',
        targetId: offerId,
        requestId: reqId,
        metadata: { roleId, agentVersionId, companyId },
      });

      await publishOutboxEvent(conn, {
        organizationId: null,
        aggregateType: 'offer',
        aggregateId: offerId,
        eventType: 'offer.created.v1',
        payload: { offerId, roleId, agentVersionId, companyId },
      });

      await conn.commit();
      return reply.status(201).send({ id: offerId, status: 'draft' });
    } catch (err) {
      await conn.rollback();
      if ((err as any)?.code === 'ER_DUP_ENTRY') {
        return reply.status(409).send({
          code: ErrorCodes.DUPLICATE_ENTRY,
          error: '相同的 Offer 已存在',
        });
      }
      throw err;
    } finally {
      conn.release();
    }
  });

  // POST /api/v1/ai-direct-hiring/offers/:id/submit — submit for approval (draft → pending_approval)
  fastify.post('/offers/:id/submit', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const reqId = requestIdFrom(request);
    const { id } = request.params;

    const offer = await fetchOffer(pool, id);
    if (!offer) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'Offer 不存在', 404);
    await requireCompanyRole(pool, offer.companyId, user.id, 'recruiter');

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const updated = await advanceOfferStatus(
        conn, pool, offer, 'pending_approval', 'submit', user.id, reqId,
        { proposedByUserId: offer.proposedByUserId },
      );
      return reply.status(200).send(updated);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  // POST /api/v1/ai-direct-hiring/offers/:id/approve — approve (pending_approval → sent)
  fastify.post('/offers/:id/approve', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const reqId = requestIdFrom(request);
    const { id } = request.params;

    const offer = await fetchOffer(pool, id);
    if (!offer) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'Offer 不存在', 404);
    // Approvers need manager or higher
    await requireCompanyRole(pool, offer.companyId, user.id, 'manager');

    if (offer.status !== 'pending_approval') {
      throw new AiDirectHiringError(
        ErrorCodes.INVALID_TRANSITION,
        `只有 pending_approval 状态的 Offer 可以审批`,
        409,
      );
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const updated = await advanceOfferStatus(
        conn, pool, offer, 'sent', 'approve', user.id, reqId,
      );
      return reply.status(200).send(updated);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  // POST /api/v1/ai-direct-hiring/offers/:id/reject — reject approval (pending_approval → rejected)
  fastify.post('/offers/:id/reject', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const reqId = requestIdFrom(request);
    const { id } = request.params;
    const body = readBody(request.body ?? {});
    const reason =
      typeof body.reason === 'string' ? body.reason.slice(0, 500) : null;

    const offer = await fetchOffer(pool, id);
    if (!offer) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'Offer 不存在', 404);
    await requireCompanyRole(pool, offer.companyId, user.id, 'manager');

    if (offer.status !== 'pending_approval') {
      throw new AiDirectHiringError(
        ErrorCodes.INVALID_TRANSITION,
        `只有 pending_approval 状态的 Offer 可以拒绝`,
        409,
      );
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const updated = await advanceOfferStatus(
        conn, pool, offer, 'rejected', 'reject', user.id, reqId,
        { reason },
      );
      return reply.status(200).send(updated);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  // POST /api/v1/ai-direct-hiring/offers/:id/send — send to candidate (pending_approval → sent)
  fastify.post('/offers/:id/send', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const reqId = requestIdFrom(request);
    const { id } = request.params;
    const body = readBody(request.body ?? {});
    const expiresAt =
      typeof body.expiresAt === 'string' && body.expiresAt.length > 0
        ? new Date(body.expiresAt)
        : null;

    const offer = await fetchOffer(pool, id);
    if (!offer) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'Offer 不存在', 404);
    await requireCompanyRole(pool, offer.companyId, user.id, 'recruiter');

    // Also allow transition from pending_approval → sent directly (skip approval workflow)
    if (!['pending_approval', 'draft'].includes(offer.status)) {
      throw new AiDirectHiringError(
        ErrorCodes.INVALID_TRANSITION,
        `Offer 当前状态 '${offer.status}' 不能发送`,
        409,
      );
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Set expires if provided
      if (expiresAt) {
        await conn.query(
          `UPDATE ai_direct_offers SET expiresAt = ?, updatedAt = NOW() WHERE id = ?`,
          [expiresAt, id],
        );
      }

      const updated = await advanceOfferStatus(
        conn, pool, { ...offer, expiresAt: expiresAt ?? offer.expiresAt },
        'sent', 'send', user.id, reqId,
      );
      return reply.status(200).send(updated);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  // POST /api/v1/ai-direct-hiring/offers/:id/accept — candidate accepts (sent → accepted)
  fastify.post('/offers/:id/accept', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const reqId = requestIdFrom(request);
    const { id } = request.params;

    const offer = await fetchOffer(pool, id);
    if (!offer) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'Offer 不存在', 404);

    // Only the offer proposer or an org member can accept
    const isProposer = offer.proposedByUserId === user.id;
    if (!isProposer) {
      await requireCompanyRole(pool, offer.companyId, user.id, 'recruiter');
    }

    if (offer.status !== 'sent') {
      throw new AiDirectHiringError(
        ErrorCodes.INVALID_TRANSITION,
        `只有 sent 状态的 Offer 可以接受`,
        409,
      );
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const updated = await advanceOfferStatus(
        conn, pool, offer, 'accepted', 'accept', user.id, reqId,
      );
      return reply.status(200).send(updated);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  // POST /api/v1/ai-direct-hiring/offers/:id/decline — candidate declines (sent → rejected)
  fastify.post('/offers/:id/decline', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const reqId = requestIdFrom(request);
    const { id } = request.params;
    const body = readBody(request.body ?? {});
    const reason =
      typeof body.reason === 'string' ? body.reason.slice(0, 500) : null;

    const offer = await fetchOffer(pool, id);
    if (!offer) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'Offer 不存在', 404);

    if (offer.status !== 'sent') {
      throw new AiDirectHiringError(
        ErrorCodes.INVALID_TRANSITION,
        `只有 sent 状态的 Offer 可以拒绝`,
        409,
      );
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const updated = await advanceOfferStatus(
        conn, pool, offer, 'rejected', 'decline', user.id, reqId,
        { reason, isCandidateAction: true },
      );
      return reply.status(200).send(updated);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  // POST /api/v1/ai-direct-hiring/offers/:id/revoke — revoke (pending_approval/draft → revoked)
  fastify.post('/offers/:id/revoke', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const reqId = requestIdFrom(request);
    const { id } = request.params;

    const offer = await fetchOffer(pool, id);
    if (!offer) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'Offer 不存在', 404);
    await requireCompanyRole(pool, offer.companyId, user.id, 'manager');

    if (!['draft', 'pending_approval', 'sent'].includes(offer.status)) {
      throw new AiDirectHiringError(
        ErrorCodes.INVALID_TRANSITION,
        `Offer 当前状态 '${offer.status}' 不能撤回`,
        409,
      );
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const updated = await advanceOfferStatus(
        conn, pool, offer, 'revoked', 'revoke', user.id, reqId,
      );
      return reply.status(200).send(updated);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  // POST /api/v1/ai-direct-hiring/offers/:id/expire — mark expired
  fastify.post('/offers/:id/expire', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const reqId = requestIdFrom(request);
    const { id } = request.params;

    const offer = await fetchOffer(pool, id);
    if (!offer) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'Offer 不存在', 404);

    if (offer.status !== 'sent') {
      throw new AiDirectHiringError(
        ErrorCodes.INVALID_TRANSITION,
        `只有 sent 状态的 Offer 可以标记为过期`,
        409,
      );
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const updated = await advanceOfferStatus(
        conn, pool, offer, 'expired', 'expire', user.id, reqId,
      );
      return reply.status(200).send(updated);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });
}
