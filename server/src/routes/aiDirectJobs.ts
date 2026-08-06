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

import type { FastifyInstance } from 'fastify';
import type { ArtifactStore } from '../services/artifactStore.js';
import { AiDirectHiringError, ErrorCodes, errorResponse } from '../services/aiDirectErrors.js';
import { requireAuth } from '../middleware/aiDirectAuth.js';
import { orgMemberAccess, requireOrganizationRole } from '../middleware/aiDirectRbac.js';
import { JobQueueService, RUN_STATUSES, type RunStatus } from '../services/jobQueue.js';
import { decodeRunCursor, RunProjectionService } from '../services/runProjection.js';

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

function parseLimit(value: unknown): number {
  if (value === undefined) return 20;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'limit 必须是 1-50 之间的整数');
  }
  return parsed;
}

function parseStatuses(value: unknown): RunStatus[] {
  if (value === undefined || value === '') return [...RUN_STATUSES];
  if (typeof value !== 'string') {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'status 必须是逗号分隔的状态列表');
  }
  const statuses = [...new Set(value.split(',').map((status) => status.trim()).filter(Boolean))];
  if (!statuses.length || statuses.some((status) => !RUN_STATUSES.includes(status as RunStatus))) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'status 包含不支持的 Job 状态');
  }
  return statuses as RunStatus[];
}

function parseCursor(value: unknown) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'cursor 无效');
  }
  const cursor = decodeRunCursor(value);
  if (!cursor) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'cursor 无效');
  return cursor;
}

type ArtifactRow = {
  id: string;
  organizationId: string;
  runId: string;
  kind: string;
  mimeType: string;
  sizeBytes: number | string | bigint;
  sha256: string;
  visibility: 'organization' | 'requester';
  storagePath: string;
  createdAt: Date | string;
};

function artifactDto(artifact: ArtifactRow) {
  return {
    artifactId: artifact.id,
    runId: artifact.runId,
    kind: artifact.kind,
    mimeType: artifact.mimeType,
    sizeBytes: Number(artifact.sizeBytes),
    sha256: artifact.sha256,
    visibility: artifact.visibility,
    createdAt: artifact.createdAt instanceof Date ? artifact.createdAt.toISOString() : String(artifact.createdAt),
    contentUrl: `/api/v1/ai-direct-hiring/jobs/${artifact.runId}/artifacts/${artifact.id}/content`,
  };
}

async function isOrganizationManager(pool: any, organizationId: string, userId: string): Promise<boolean> {
  try {
    await requireOrganizationRole(pool, organizationId, userId, 'manager');
    return true;
  } catch (error) {
    if (error instanceof AiDirectHiringError && error.code === ErrorCodes.FORBIDDEN_SCOPE) return false;
    throw error;
  }
}

async function requireArtifactReadAccess(
  pool: any,
  artifact: Pick<ArtifactRow, 'organizationId' | 'visibility'>,
  requestedByUserId: string,
  userId: string,
): Promise<void> {
  if (await isOrganizationManager(pool, artifact.organizationId, userId)) return;
  if (artifact.visibility === 'requester' && requestedByUserId === userId) return;
  const membership = await orgMemberAccess(pool, artifact.organizationId, userId);
  if (!membership) {
    throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, '用户无权访问该产物', 403);
  }
  throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, '该产物仅对管理者或请求者可见', 403);
}

export function createAiDirectJobsRoutes(artifactStore?: ArtifactStore) {
  return async function aiDirectJobsRoutes(fastify: FastifyInstance) {
    const pool = (fastify as any).mysql;
    const auth = [(fastify as any).authenticate];

  // GET /jobs?organizationId=...&limit=20&cursor=...&status=queued,active
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
      const page = await projection.listRuns(organizationId, {
        limit: parseLimit(request.query?.limit),
        cursor: parseCursor(request.query?.cursor),
        statuses: parseStatuses(request.query?.status),
      });
      return page;
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
        throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, 'Job 不存在', 404);
      }
      const manager = meta.organizationId
        ? await isOrganizationManager(pool, meta.organizationId, user.id)
        : meta.requestedByUserId === user.id;
      if (!manager && meta.requestedByUserId !== user.id) {
        throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, '用户无权访问该 Job 产物', 403);
      }
      const [rows] = await pool.query(
        `SELECT id, organizationId, runId, kind, mimeType, sizeBytes, sha256, visibility, storagePath, createdAt
         FROM ai_direct_artifacts
         WHERE runId = ?${manager ? '' : " AND visibility = 'requester'"}
         ORDER BY createdAt ASC, id ASC
         LIMIT 500`,
        [id],
      );
      return { items: rows.map(artifactDto) };
    } catch (err) {
      if (err instanceof AiDirectHiringError) {
        return reply.status(err.httpStatus).send(errorResponse(err));
      }
      throw err;
    }
  });

  fastify.get('/jobs/:id/artifacts/:artifactId/content', { onRequest: auth }, async (request: any, reply) => {
    try {
      const user = await requireAuth(fastify, request);
      const { id, artifactId } = request.params as { id: string; artifactId: string };
      const [rows] = await pool.query(
        `SELECT a.id, a.organizationId, a.runId, a.kind, a.mimeType, a.sizeBytes, a.sha256,
                a.visibility, a.storagePath, a.createdAt, r.requestedByUserId
         FROM ai_direct_artifacts a
         JOIN ai_direct_workflow_runs r ON r.id = a.runId
         WHERE a.id = ? AND a.runId = ?
         LIMIT 1`,
        [artifactId, id],
      );
      const artifact = rows[0] as (ArtifactRow & { requestedByUserId: string }) | undefined;
      if (!artifact) {
        throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, '产物不存在', 404);
      }
      await requireArtifactReadAccess(pool, artifact, artifact.requestedByUserId, user.id);
      if (!artifactStore) {
        throw new AiDirectHiringError(
          ErrorCodes.RUNTIME_CAPABILITY_DISABLED,
          '产物下载尚未启用',
          503,
        );
      }
      const stream = await artifactStore.openVerified({
        storagePath: artifact.storagePath,
        sizeBytes: Number(artifact.sizeBytes),
        sha256: artifact.sha256,
      });
      return reply
        .header('Content-Type', artifact.mimeType)
        .header('Content-Length', String(artifact.sizeBytes))
        .header('ETag', `"${artifact.sha256}"`)
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .send(stream);
    } catch (err) {
      if (err instanceof AiDirectHiringError) {
        return reply.status(err.httpStatus).send(errorResponse(err));
      }
      request.log.error({ err, artifactId: request.params?.artifactId }, 'Artifact verification failed');
      return reply.status(404).send({
        code: ErrorCodes.NOT_FOUND,
        error: '产物不可用或完整性校验失败',
      });
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
  };
}

export const aiDirectJobsRoutes = createAiDirectJobsRoutes();