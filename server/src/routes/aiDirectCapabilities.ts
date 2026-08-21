/**
 * AI Direct Hiring — Capability Grants routes (P2).
 *
 * Endpoints:
 *   GET  /api/v1/ai-direct-hiring/employments/:id/capabilities  — list capabilities for an employment
 *   POST /api/v1/ai-direct-hiring/employments/:id/capabilities  — grant capability
 *   DELETE /api/v1/ai-direct-hiring/capabilities/:id             — revoke capability
 */

import { randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/aiDirectAuth.js";
import { requireCompanyRole, requireEmploymentScope } from "../middleware/aiDirectRbac.js";
import { AiDirectHiringError, ErrorCodes } from "../services/aiDirectErrors.js";
import { publishOutboxEvent } from "../utils/outbox.js";

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
      input.outcome ?? "success",
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );
}

// ─── Routes ────────────────────────────────────────────────────────────────────

export async function aiDirectCapabilitiesRoutes(fastify: FastifyInstance) {
  const pool = (fastify as any).mysql as any;
  const auth = [(fastify as any).authenticate];

  // GET /api/v1/ai-direct-hiring/employments/:id/capabilities
  fastify.get("/employments/:id/capabilities", { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request);
    const { id } = request.params;
    await requireEmploymentScope(pool, id, user.id);

    const [rows] = await pool.query(
      `SELECT id, subjectType, subjectId, resourceType, resourceId, action,
              scope, issuedByUserId, issuedAt, expiresAt, revokedAt, revokedByUserId, revokeReason
       FROM ai_direct_capability_grants
       WHERE subjectType = 'employment' AND subjectId = ?
       AND revokedAt IS NULL
       ORDER BY issuedAt DESC LIMIT 200`,
      [id],
    );
    return { items: rows };
  });

  // POST /api/v1/ai-direct-hiring/employments/:id/capabilities — grant capability
  fastify.post(
    "/employments/:id/capabilities",
    { onRequest: auth },
    async (request: any, reply) => {
      const user = await requireAuth(fastify, request);
      const reqId = requestIdFrom(request);
      const { id } = request.params;
      const body = readBody(request.body);
      rejectExtra(
        body,
        ["resourceType", "resourceId", "action", "scope", "expiresAt"],
        "POST /capabilities",
      );

      const employment = await requireEmploymentScope(pool, id, user.id);
      await requireCompanyRole(pool, employment.companyId, user.id, "manager");

      const resourceType = readString(body.resourceType, "resourceType", 64);
      const resourceId = readString(body.resourceId, "resourceId", 191);
      const action = readString(body.action, "action", 64);
      const scope = body.scope && typeof body.scope === "object" ? body.scope : null;
      const expiresAt =
        typeof body.expiresAt === "string" && body.expiresAt.length > 0
          ? new Date(body.expiresAt)
          : null;

      const grantId = randomUUID();
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        // Active grants are unique by employment/resource/action. Repeated requests replay the existing grant.
        const [existing] = await conn.query(
          `SELECT id FROM ai_direct_capability_grants
         WHERE subjectType = 'employment' AND subjectId = ?
         AND resourceType = ? AND resourceId = ? AND action = ?
         AND revokedAt IS NULL LIMIT 1`,
          [id, resourceType, resourceId, action],
        );
        const existingRow = (existing as any[])[0];
        if (existingRow) {
          await conn.rollback();
          return reply.status(200).send({ id: existingRow.id, replayed: true });
        }

        await conn.query(
          `INSERT INTO ai_direct_capability_grants
         (id, subjectType, subjectId, resourceType, resourceId, action, scope,
          issuedByUserId, expiresAt)
         VALUES (?, 'employment', ?, ?, ?, ?, ?, ?, ?)`,
          [
            grantId,
            id,
            resourceType,
            resourceId,
            action,
            scope ? JSON.stringify(scope) : null,
            user.id,
            expiresAt,
          ],
        );

        await writeAudit(conn, {
          organizationId: null,
          actorUserId: user.id,
          action: "capability.granted",
          targetType: "capability_grant",
          targetId: grantId,
          requestId: reqId,
          metadata: { employmentId: id, resourceType, resourceId, action },
        });

        await publishOutboxEvent(conn, {
          organizationId: null,
          aggregateType: "capability_grant",
          aggregateId: grantId,
          eventType: "capability.granted.v1",
          payload: { grantId, employmentId: id, resourceType, resourceId, action },
        });

        await conn.commit();
        return reply.status(201).send({ id: grantId });
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    },
  );

  // DELETE /api/v1/ai-direct-hiring/capabilities/:id — revoke capability
  fastify.delete("/capabilities/:id", { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const reqId = requestIdFrom(request);
    const { id } = request.params;

    const [rows] = await pool.query(
      `SELECT cg.*, e.companyId
       FROM ai_direct_capability_grants cg
       JOIN ai_direct_employments e ON e.id = cg.subjectId AND cg.subjectType = 'employment'
       WHERE cg.id = ? LIMIT 1`,
      [id],
    );
    const grant = (rows as any[])[0];
    if (!grant)
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "Capability 不存在", 404);
    if (grant.revokedAt) {
      return reply.status(200).send({ id, revoked: true, replayed: true });
    }

    await requireCompanyRole(pool, grant.companyId, user.id, "manager");

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query(
        `UPDATE ai_direct_capability_grants
         SET revokedAt = NOW(), revokedByUserId = ?, revokeReason = NULL
         WHERE id = ? AND revokedAt IS NULL`,
        [user.id, id],
      );

      await writeAudit(conn, {
        organizationId: null,
        actorUserId: user.id,
        action: "capability.revoked",
        targetType: "capability_grant",
        targetId: id,
        requestId: reqId,
        metadata: { subjectId: grant.subjectId, resourceType: grant.resourceType },
      });

      await publishOutboxEvent(conn, {
        organizationId: null,
        aggregateType: "capability_grant",
        aggregateId: id,
        eventType: "capability.revoked.v1",
        payload: { grantId: id, subjectId: grant.subjectId },
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
