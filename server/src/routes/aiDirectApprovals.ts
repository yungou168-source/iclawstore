/**
 * AI Direct Hiring — Approvals routes (P2).
 *
 * Endpoints:
 *   GET  /api/v1/ai-direct-hiring/approvals                           — list approvals
 *   POST /api/v1/ai-direct-hiring/approvals/:id/approve             — approve
 *   POST /api/v1/ai-direct-hiring/approvals/:id/reject              — reject
 *   POST /api/v1/ai-direct-hiring/approvals/:id/cancel              — cancel (requester)
 */

import { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { AiDirectHiringError, ErrorCodes } from '../services/aiDirectErrors.js';
import { publishOutboxEvent } from '../utils/outbox.js';
import { requireAuth } from '../middleware/aiDirectAuth.js';
import {
  transitionApproval,
  isApprovalTerminal,
  type ApprovalStatus,
} from '../services/approvalStateMachine.js';

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

async function advanceApprovalStatus(
  conn: any,
  approval: any,
  toStatus: ApprovalStatus,
  event: string,
  actorUserId: string,
  reqId: string,
  reason?: string | null,
): Promise<any> {
  const transition = transitionApproval(approval.status as ApprovalStatus, toStatus, event);

  const updateFields: string[] = ['status = ?', 'updatedAt = NOW()'];
  const updateParams: unknown[] = [toStatus];

  if (toStatus === 'approved' || toStatus === 'rejected') {
    updateFields.push('decidedAt = NOW()');
    updateFields.push('decision = ?');
    updateParams.push(toStatus);
  }

  if (reason) {
    updateFields.push('decisionReason = ?');
    updateParams.push(reason);
  }

  const updateQuery = `UPDATE ai_direct_approvals SET ${updateFields.join(', ')} WHERE id = ?`;
  await conn.query(updateQuery, [...updateParams, approval.id]);

  await writeAudit(conn, {
    organizationId: approval.organizationId,
    actorUserId,
    action: `approval.${event}`,
    targetType: 'approval',
    targetId: approval.id,
    requestId: reqId,
    metadata: { from: transition.from, to: transition.to, targetType: approval.targetType, targetId: approval.targetId },
  });

  await publishOutboxEvent(conn, {
    organizationId: approval.organizationId,
    aggregateType: 'approval',
    aggregateId: approval.id,
    eventType: `approval.${event}.v1`,
    payload: {
      approvalId: approval.id,
      targetType: approval.targetType,
      targetId: approval.targetId,
      from: transition.from,
      to: transition.to,
      actorUserId,
    },
  });

  // Read through the transaction connection so the response reflects this decision.
  const [rows] = await conn.query(
    `SELECT * FROM ai_direct_approvals WHERE id = ? LIMIT 1`,
    [approval.id],
  );
  return (rows as any[])[0];
}

// ─── Routes ────────────────────────────────────────────────────────────────────

export async function aiDirectApprovalsRoutes(fastify: FastifyInstance) {
  const pool = (fastify as any).mysql as any;
  const auth = [(fastify as any).authenticate];

  // GET /api/v1/ai-direct-hiring/approvals — list approvals
  fastify.get('/approvals', { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request);
    const status = typeof request.query?.status === 'string' ? request.query.status : null;

    let sql = `
      SELECT a.id, a.organizationId, a.targetType, a.targetId, a.requestedByUserId,
             a.approverUserId, a.status, a.decision, a.decisionReason,
             a.expiresAt, a.decidedAt, a.metadata, a.createdAt, a.updatedAt
      FROM ai_direct_approvals a
      WHERE (
        a.requestedByUserId = ?
        OR a.approverUserId = ?
        OR a.organizationId IN (
          SELECT organizationId FROM ai_direct_organization_members
          WHERE userId = ? AND status = 'active'
        )
      )`;
    const params: unknown[] = [user.id, user.id, user.id];

    if (status) {
      sql += ` AND a.status = ?`;
      params.push(status);
    }
    sql += ` ORDER BY a.updatedAt DESC LIMIT 100`;

    const [rows] = await pool.query(sql, params);
    return { items: rows };
  });

  // POST /api/v1/ai-direct-hiring/approvals/:id/approve — approve
  fastify.post('/approvals/:id/approve', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const reqId = requestIdFrom(request);
    const { id } = request.params;

    const [rows] = await pool.query(
      `SELECT * FROM ai_direct_approvals WHERE id = ? LIMIT 1`,
      [id],
    );
    const approval = (rows as any[])[0];
    if (!approval) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'Approval 不存在', 404);

    if (approval.status !== 'pending') {
      throw new AiDirectHiringError(
        ErrorCodes.INVALID_TRANSITION,
        `只有 pending 状态的 Approval 可以审批，当前: '${approval.status}'`,
        409,
      );
    }

    // Must be the assigned approver or an org admin
    if (approval.approverUserId && approval.approverUserId !== user.id) {
      throw new AiDirectHiringError(
        ErrorCodes.FORBIDDEN_SCOPE,
        '只有指定的审批人可以审批此请求',
        403,
      );
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Set approver if not already set
      if (!approval.approverUserId) {
        await conn.query(
          `UPDATE ai_direct_approvals SET approverUserId = ?, updatedAt = NOW() WHERE id = ?`,
          [user.id, id],
        );
      }

      const updated = await advanceApprovalStatus(
        conn, approval, 'approved', 'approve', user.id, reqId,
      );

      // If this approval is linked to an offer, advance the offer
      if (approval.targetType === 'offer' && approval.targetId) {
        const [offerUpdate] = await conn.query(
          `UPDATE ai_direct_offers SET approvalId = ?, status = 'sent', updatedAt = NOW() WHERE id = ? AND status = 'pending_approval'`,
          [id, approval.targetId],
        );
        if (Number((offerUpdate as { affectedRows?: number }).affectedRows ?? 0) !== 1) {
          throw new AiDirectHiringError(
            ErrorCodes.INVALID_TRANSITION,
            '关联 Offer 已不处于 pending_approval 状态',
            409,
          );
        }
      }

      await conn.commit();
      return reply.status(200).send(updated);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  // POST /api/v1/ai-direct-hiring/approvals/:id/reject — reject
  fastify.post('/approvals/:id/reject', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const reqId = requestIdFrom(request);
    const { id } = request.params;
    const body = readBody(request.body ?? {});
    const reason =
      typeof body.reason === 'string' ? body.reason.slice(0, 500) : null;

    const [rows] = await pool.query(
      `SELECT * FROM ai_direct_approvals WHERE id = ? LIMIT 1`,
      [id],
    );
    const approval = (rows as any[])[0];
    if (!approval) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'Approval 不存在', 404);

    if (approval.status !== 'pending') {
      throw new AiDirectHiringError(
        ErrorCodes.INVALID_TRANSITION,
        `只有 pending 状态的 Approval 可以拒绝，当前: '${approval.status}'`,
        409,
      );
    }

    if (approval.approverUserId && approval.approverUserId !== user.id) {
      throw new AiDirectHiringError(
        ErrorCodes.FORBIDDEN_SCOPE,
        '只有指定的审批人可以拒绝此请求',
        403,
      );
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      if (!approval.approverUserId) {
        await conn.query(
          `UPDATE ai_direct_approvals SET approverUserId = ?, updatedAt = NOW() WHERE id = ?`,
          [user.id, id],
        );
      }

      const updated = await advanceApprovalStatus(
        conn, approval, 'rejected', 'reject', user.id, reqId, reason,
      );

      // If linked to an offer, advance the offer to rejected
      if (approval.targetType === 'offer' && approval.targetId) {
        await conn.query(
          `UPDATE ai_direct_offers SET rejectedAt = NOW(), rejectedReason = ?, updatedAt = NOW() WHERE id = ? AND status = 'pending_approval'`,
          [reason ?? 'Approval rejected', approval.targetId],
        ).catch(() => {/* ignore if offer not in expected state */});
      }

      await conn.commit();
      return reply.status(200).send(updated);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  // POST /api/v1/ai-direct-hiring/approvals/:id/cancel — cancel (requester)
  fastify.post('/approvals/:id/cancel', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const reqId = requestIdFrom(request);
    const { id } = request.params;

    const [rows] = await pool.query(
      `SELECT * FROM ai_direct_approvals WHERE id = ? LIMIT 1`,
      [id],
    );
    const approval = (rows as any[])[0];
    if (!approval) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'Approval 不存在', 404);

    if (approval.status !== 'pending') {
      throw new AiDirectHiringError(
        ErrorCodes.INVALID_TRANSITION,
        `只有 pending 状态的 Approval 可以取消，当前: '${approval.status}'`,
        409,
      );
    }

    // Only requester or approver can cancel
    if (approval.requestedByUserId !== user.id && approval.approverUserId !== user.id) {
      throw new AiDirectHiringError(
        ErrorCodes.FORBIDDEN_SCOPE,
        '只有请求者或审批人可以取消此请求',
        403,
      );
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const updated = await advanceApprovalStatus(
        conn, approval, 'cancelled', 'cancel', user.id, reqId,
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
}
