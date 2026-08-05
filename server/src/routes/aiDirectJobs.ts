/**
 * AI Direct Hiring — Job Queue Routes (P1 Runtime Center, Agent G).
 *
 * Endpoints:
 *   GET    /jobs                       — list active runs for a company
 *   GET    /jobs/:id                   — run detail with steps
 *   POST   /jobs/:id/cancel            — cancel a queued/active run
 *   POST   /jobs/:id/retry             — clone a failed run into a new queued run
 *
 * All endpoints require:
 *   - Authenticated user
 *   - Manager+ role on the target company
 *
 * Note: workflow_runs rows are scoped via organizationId; the company
 * RBAC lookup joins org membership via `ai_direct_companies.organizationId`.
 * For runs without a companyId (system-initiated runs), the route still
 * requires auth but skips RBAC.
 */

import { FastifyInstance } from 'fastify';
import { AiDirectHiringError, ErrorCodes, errorResponse } from '../services/aiDirectErrors.js';
import { requireAuth } from '../middleware/aiDirectAuth.js';
import { requireOrganizationRole } from '../middleware/aiDirectRbac.js';
import { JobQueueService } from '../services/jobQueue.js';
import { RunProjectionService } from '../services/runProjection.js';

async function resolveRunOrganization(
  pool: any,
  runId: string,
): Promise<{ organizationId: string | null; requestedByUserId: string; status: string } | null> {
  const [rows] = await pool.query(
    `SELECT organizationId, requestedByUserId, status
     FROM ai_direct_workflow_runs WHERE id = ? LIMIT 1`,
    [runId],
  );
  const row = (rows as any[])[0];
  return row
    ? {
        organizationId: row.organizationId ?? null,
        requestedByUserId: row.requestedByUserId,
        status: row.status,
      }
    : null;
}

async function requireRunAccess(
  pool: any,
  meta: { organizationId: string | null; requestedByUserId: string },
  userId: string,
): Promise<void> {
  if (meta.organizationId) {
    await requireOrganizationRole(pool, meta.organizationId, userId, 'manager');
    return;
  }
  if (meta.requestedByUserId !== userId) {
    throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, '用户无权访问该 Job', 403);
  }
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

function readStringOr(value: unknown, field: string, fallback: string): string {
  if (value === undefined || value === null) return fallback;
  return readString(value, field, 1024);
}

export async function aiDirectJobsRoutes(fastify: FastifyInstance) {
  const pool = (fastify as any).mysql;
  const auth = [(fastify as any).authenticate];

  // GET /jobs?organizationId=...  — list active runs for the org
  fastify.get('/jobs', { onRequest: auth }, async (request: any, reply) => {
    try {
      const user = await requireAuth(fastify, request);
      const organizationId = readStringOr(request.query?.organizationId, 'organizationId', '');
      if (!organizationId) {
        throw new AiDirectHiringError(
          ErrorCodes.VALIDATION_ERROR,
          'organizationId 是必需的',
          400,
        );
      }
      await requireOrganizationRole(pool, organizationId, user.id, 'manager');
      const projection = new RunProjectionService(pool);
      const items = await projection.getActiveRuns(organizationId);
      return { items, count: items.length };
    } catch (err) {
      if (err instanceof AiDirectHiringError) {
        return reply.status(err.httpStatus).send(errorResponse(err));
      }
      throw err;
    }
  });

  // GET /jobs/:id — full detail
  fastify.get('/jobs/:id', { onRequest: auth }, async (request: any, reply) => {
    try {
      const user = await requireAuth(fastify, request);
      const { id } = request.params;
      const meta = await resolveRunOrganization(pool, id);
      if (!meta) {
        throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'Job 不存在', 404);
      }
      await requireRunAccess(pool, meta, user.id);
      const projection = new RunProjectionService(pool);
      const detail = await projection.getRun(id, meta.organizationId ?? undefined);
      if (!detail) {
        throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'Job 不存在', 404);
      }
      return detail;
    } catch (err) {
      if (err instanceof AiDirectHiringError) {
        return reply.status(err.httpStatus).send(errorResponse(err));
      }
      throw err;
    }
  });

  fastify.get('/jobs/:id/artifacts', { onRequest: auth }, async (request: any, reply) => {
    try {
      const user = await requireAuth(fastify, request);
      const { id } = request.params;
      const meta = await resolveRunOrganization(pool, id);
      if (!meta) {
        throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'Job 不存在', 404);
      }
      await requireRunAccess(pool, meta, user.id);
      const [rows] = await pool.query(
        `SELECT id, organizationId, runId, stepId, kind, storagePath, mimeType,
                sizeBytes, sha256, visibility, createdAt
         FROM ai_direct_artifacts WHERE runId = ? ORDER BY createdAt ASC LIMIT 500`,
        [id],
      );
      return { items: rows };
    } catch (err) {
      if (err instanceof AiDirectHiringError) {
        return reply.status(err.httpStatus).send(errorResponse(err));
      }
      throw err;
    }
  });

  // POST /jobs/:id/cancel — cancel a queued/active run
  fastify.post('/jobs/:id/cancel', { onRequest: auth }, async (request: any, reply) => {
    try {
      const user = await requireAuth(fastify, request);
      const { id } = request.params;
      const body = request.body ?? {};
      const reason = readString(body.reason ?? '', 'reason', 500);
      const meta = await resolveRunOrganization(pool, id);
      if (!meta) {
        throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'Job 不存在', 404);
      }
      await requireRunAccess(pool, meta, user.id);
      const queue = new JobQueueService(pool);
      await queue.cancel(id, reason, user.id);
      return reply.status(200).send({ runId: id, status: 'cancelled' });
    } catch (err) {
      if (err instanceof AiDirectHiringError) {
        return reply.status(err.httpStatus).send(errorResponse(err));
      }
      if (err instanceof Error) {
        return reply.status(409).send({
          code: ErrorCodes.INVALID_TRANSITION,
          error: err.message,
        });
      }
      throw err;
    }
  });

  // POST /jobs/:id/retry — clone a failed run
  fastify.post('/jobs/:id/retry', { onRequest: auth }, async (request: any, reply) => {
    try {
      const user = await requireAuth(fastify, request);
      const { id } = request.params;
      const meta = await resolveRunOrganization(pool, id);
      if (!meta) {
        throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'Job 不存在', 404);
      }
      await requireRunAccess(pool, meta, user.id);
      if (meta.status !== 'failed' && meta.status !== 'cancelled') {
        throw new AiDirectHiringError(
          ErrorCodes.INVALID_TRANSITION,
          `只有失败或已取消的 Job 可以重试（当前状态：${meta.status}）`,
          409,
          { currentStatus: meta.status },
        );
      }
      const queue = new JobQueueService(pool);
      const result = await queue.retry(id, user.id);
      return reply.status(201).send({ originalRunId: id, newRunId: result.runId });
    } catch (err) {
      if (err instanceof AiDirectHiringError) {
        return reply.status(err.httpStatus).send(errorResponse(err));
      }
      if (err instanceof Error) {
        return reply.status(409).send({
          code: ErrorCodes.INVALID_TRANSITION,
          error: err.message,
        });
      }
      throw err;
    }
  });
}