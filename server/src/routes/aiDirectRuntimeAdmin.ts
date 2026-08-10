import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/aiDirectAuth.js";
import { requireOrganizationRole } from "../middleware/aiDirectRbac.js";
import { AiDirectHiringError, ErrorCodes, errorResponse } from "../services/aiDirectErrors.js";
import { createWorkerToken, revokeWorkerToken } from "../services/workerTokens.js";

function readText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 必须是字符串`);
  }
  const result = value.trim();
  if (!result || result.length > maxLength) {
    throw new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      `${field} 长度必须为 1-${maxLength}`,
    );
  }
  return result;
}

function readExpiry(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "expiresAt 必须是 ISO 时间字符串");
  }
  const result = new Date(value);
  if (!Number.isFinite(result.getTime()) || result <= new Date()) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "expiresAt 必须是未来时间");
  }
  return result;
}

export async function aiDirectRuntimeAdminRoutes(fastify: FastifyInstance): Promise<void> {
  const pool = (fastify as any).mysql;
  const auth = [(fastify as any).authenticate];

  fastify.post("/worker-tokens", { onRequest: auth }, async (request: any, reply) => {
    try {
      const user = await requireAuth(fastify, request);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const organizationId = readText(body.organizationId, "organizationId", 36);
      const workerId = readText(body.workerId, "workerId", 128);
      const name = readText(body.name, "name", 160);
      await requireOrganizationRole(pool, organizationId, user.id, "admin");
      const result = await createWorkerToken(pool, {
        organizationId,
        workerId,
        name,
        createdByUserId: user.id,
        expiresAt: readExpiry(body.expiresAt),
      });
      return reply.status(201).send({
        id: result.id,
        workerId,
        token: result.token,
        tokenPrefix: result.tokenPrefix,
      });
    } catch (error) {
      if (error instanceof AiDirectHiringError) {
        return reply.status(error.httpStatus).send(errorResponse(error));
      }
      throw error;
    }
  });

  fastify.get("/worker-tokens", { onRequest: auth }, async (request: any, reply) => {
    try {
      const user = await requireAuth(fastify, request);
      const organizationId = readText(request.query?.organizationId, "organizationId", 36);
      await requireOrganizationRole(pool, organizationId, user.id, "admin");
      const [rows] = await pool.query(
        `SELECT id, organizationId, workerId, name, tokenPrefix, status,
                expiresAt, lastUsedAt, revokedAt, createdByUserId, createdAt, updatedAt
         FROM ai_direct_worker_tokens
         WHERE organizationId = ? ORDER BY createdAt DESC LIMIT 200`,
        [organizationId],
      );
      return { items: rows };
    } catch (error) {
      if (error instanceof AiDirectHiringError) {
        return reply.status(error.httpStatus).send(errorResponse(error));
      }
      throw error;
    }
  });

  fastify.delete("/worker-tokens/:id", { onRequest: auth }, async (request: any, reply) => {
    try {
      const user = await requireAuth(fastify, request);
      const tokenId = readText(request.params?.id, "id", 36);
      const [rows] = await pool.query(
        `SELECT organizationId FROM ai_direct_worker_tokens WHERE id = ? LIMIT 1`,
        [tokenId],
      );
      const token = (rows as Array<{ organizationId: string }>)[0];
      if (!token) {
        throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "Worker token 不存在", 404);
      }
      await requireOrganizationRole(pool, token.organizationId, user.id, "admin");
      const revoked = await revokeWorkerToken(pool, tokenId, token.organizationId);
      return reply.status(200).send({ id: tokenId, revoked });
    } catch (error) {
      if (error instanceof AiDirectHiringError) {
        return reply.status(error.httpStatus).send(errorResponse(error));
      }
      throw error;
    }
  });

  fastify.get("/runtime/metrics", { onRequest: auth }, async (request: any, reply) => {
    try {
      const user = await requireAuth(fastify, request);
      const organizationId = readText(request.query?.organizationId, "organizationId", 36);
      await requireOrganizationRole(pool, organizationId, user.id, "manager");
      const [runRows] = await pool.query(
        `SELECT
           SUM(status = 'queued') AS queued,
           SUM(status = 'active') AS active,
           SUM(status = 'failed') AS failed,
           SUM(status = 'active' AND leaseExpiresAt <= NOW(3)) AS expired
         FROM ai_direct_workflow_runs WHERE organizationId = ?`,
        [organizationId],
      );
      const [outboxRows] = await pool.query(
        `SELECT MIN(occurredAt) AS oldestPendingOutboxAt
         FROM ai_direct_outbox_events
         WHERE organizationId = ? AND status = 'pending'`,
        [organizationId],
      );
      const [metricRows] = await pool.query(
        `SELECT metricKey, metricValue, updatedAt FROM ai_direct_runtime_metrics`,
      );
      const [workerRows] = await pool.query(
        `SELECT leaseOwner AS workerId, MAX(lastHeartbeatAt) AS lastHeartbeatAt,
                COUNT(*) AS activeRuns
         FROM ai_direct_workflow_runs
         WHERE organizationId = ? AND status = 'active' AND leaseOwner IS NOT NULL
         GROUP BY leaseOwner ORDER BY lastHeartbeatAt DESC`,
        [organizationId],
      );
      const counts = (runRows as any[])[0] ?? {};
      return {
        runs: {
          queued: Number(counts.queued ?? 0),
          active: Number(counts.active ?? 0),
          failed: Number(counts.failed ?? 0),
          expired: Number(counts.expired ?? 0),
        },
        oldestPendingOutboxAt: (outboxRows as any[])[0]?.oldestPendingOutboxAt ?? null,
        counters: metricRows,
        workers: workerRows,
      };
    } catch (error) {
      if (error instanceof AiDirectHiringError) {
        return reply.status(error.httpStatus).send(errorResponse(error));
      }
      throw error;
    }
  });
}
