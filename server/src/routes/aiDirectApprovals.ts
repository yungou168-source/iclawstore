/**
 * AI Direct Hiring — Approvals routes (P2).
 *
 * Endpoints:
 *   GET  /api/v1/ai-direct-hiring/approvals                           — list approvals
 *   POST /api/v1/ai-direct-hiring/approvals/:id/approve             — approve
 *   POST /api/v1/ai-direct-hiring/approvals/:id/reject              — reject
 *   POST /api/v1/ai-direct-hiring/approvals/:id/cancel              — cancel (requester)
 */

import { randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/aiDirectAuth.js";
import { requireOrganizationRole } from "../middleware/aiDirectRbac.js";
import { AiDirectHiringError, ErrorCodes } from "../services/aiDirectErrors.js";
import { authorizeApprovalAction } from "../services/approvalAuthorization.js";
import { decideApproval } from "../services/approvalDecision.js";
import { delegateApproval } from "../services/approvalDelegation.js";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function requestIdFrom(request: { headers: Record<string, unknown> }): string {
  const value = request.headers["x-request-id"];
  return typeof value === "string" && value.length > 0 && value.length <= 128
    ? value
    : randomUUID();
}

function readBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "请求体必须是对象");
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") {
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
      `${caller} 不接受以下字段: ${extra.join(", ")}`,
      400,
      { extraFields: extra },
    );
  }
}

// ─── Routes ────────────────────────────────────────────────────────────────────

export async function aiDirectApprovalsRoutes(fastify: FastifyInstance) {
  const pool = (fastify as any).mysql as any;
  const auth = [(fastify as any).authenticate];

  // GET /api/v1/ai-direct-hiring/approvals — organization-scoped work queue.
  fastify.get("/approvals", { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request);
    const organizationId = readString(request.query?.organizationId, "organizationId", 36);
    const status = typeof request.query?.status === "string" ? request.query.status : null;
    const scope = request.query?.scope === "mine" ? "mine" : "organization";
    await requireOrganizationRole(
      pool,
      organizationId,
      user.id,
      scope === "mine" ? "member" : "manager",
    );

    let sql = `SELECT a.id, a.organizationId, a.targetType, a.targetId, a.requestedByUserId,
                      a.approverUserId, a.status, a.decision, a.decisionReason,
                      a.expiresAt, a.decidedAt, a.metadata, a.createdAt, a.updatedAt
               FROM ai_direct_approvals a WHERE a.organizationId = ?`;
    const params: unknown[] = [organizationId];
    if (scope === "mine") {
      sql += " AND (a.requestedByUserId = ? OR a.approverUserId = ?)";
      params.push(user.id, user.id);
    }
    if (status) {
      sql += " AND a.status = ?";
      params.push(status);
    }
    sql += " ORDER BY a.updatedAt DESC, a.id DESC LIMIT 100";
    const [rows] = await pool.query(sql, params);
    return { items: rows };
  });

  fastify.post("/approvals/:id/delegate", { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const body = readBody(request.body ?? {});
    rejectExtra(body, ["toUserId", "reason"], "POST /approvals/:id/delegate");
    const result = await delegateApproval(pool, {
      approvalId: request.params.id,
      actorUserId: user.id,
      toUserId: readString(body.toUserId, "toUserId", 191),
      requestId: requestIdFrom(request),
      reason: body.reason === undefined ? null : readString(body.reason, "reason", 500),
    });
    return reply.status(201).send(result);
  });

  // POST /api/v1/ai-direct-hiring/approvals/:id/approve — approve
  fastify.post("/approvals/:id/approve", { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const updated = await decideApproval(pool, {
      approvalId: request.params.id,
      decision: "approved",
      actorUserId: user.id,
      requestId: requestIdFrom(request),
      authorize: (approval, connection) =>
        authorizeApprovalAction(connection, approval, "approve", user.id),
    });
    return reply.status(200).send(updated);
  });

  // POST /api/v1/ai-direct-hiring/approvals/:id/reject — reject
  fastify.post("/approvals/:id/reject", { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const body = readBody(request.body ?? {});
    const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : null;
    const updated = await decideApproval(pool, {
      approvalId: request.params.id,
      decision: "rejected",
      actorUserId: user.id,
      requestId: requestIdFrom(request),
      reason,
      authorize: (approval, connection) =>
        authorizeApprovalAction(connection, approval, "reject", user.id),
    });
    return reply.status(200).send(updated);
  });

  // POST /api/v1/ai-direct-hiring/approvals/:id/cancel — cancel (requester)
  fastify.post("/approvals/:id/cancel", { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const updated = await decideApproval(pool, {
      approvalId: request.params.id,
      decision: "cancelled",
      actorUserId: user.id,
      requestId: requestIdFrom(request),
      authorize: (approval, connection) =>
        authorizeApprovalAction(connection, approval, "cancel", user.id),
    });
    return reply.status(200).send(updated);
  });
}
