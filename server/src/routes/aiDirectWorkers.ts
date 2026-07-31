/**
 * AI Direct Hiring — Worker Interface Routes (P1 Runtime Center, Agent G).
 *
 * Endpoints (worker-facing, scoped to internal worker tokens):
 *   POST /workers/heartbeat        — refresh lease on a leased run
 *   GET  /workers/lease            — claim the next queued run
 *   POST /workers/complete         — mark a step + (optionally) the run done
 *
 * Auth: these endpoints are intentionally NOT exposed to normal users.
 * They are mounted under the AI Direct Hiring prefix but should be
 * restricted at the gateway / reverse-proxy layer (e.g. only allow
 * requests with `X-Worker-Secret` matching a known value).
 *
 * Worker protocol:
 *   1. loop:
 *        next = GET /workers/lease  (X-Worker-Id required)
 *        if next is null: sleep(2s) and continue
 *        ack internally (no separate ack call needed — lease is set)
 *        execute step...
 *        POST /workers/complete { runId, sequence, status, output }
 *      until SIGTERM
 *   2. every 20s, send POST /workers/heartbeat { runId }
 *      to extend the lease past LEASE_TTL_SECONDS (60s).
 */

import { FastifyInstance } from 'fastify';
import { AiDirectHiringError, ErrorCodes, errorResponse } from '../services/aiDirectErrors.js';
import { JobQueueService } from '../services/jobQueue.js';

function readWorkerId(request: { headers: Record<string, unknown> }): string {
  const value = request.headers['x-worker-id'];
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      'X-Worker-Id 头部必须是非空字符串（≤128 字符）',
      400,
    );
  }
  return value;
}

function readRunId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 36) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 必须是 1-36 字符的 ID`);
  }
  return value;
}

function readSequence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 1000) {
    throw new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      'sequence 必须是 1-1000 之间的整数',
    );
  }
  return value;
}

export async function aiDirectWorkersRoutes(fastify: FastifyInstance) {
  const pool = (fastify as any).mysql;

  // POST /workers/heartbeat — refresh lease
  fastify.post('/workers/heartbeat', async (request: any, reply) => {
    try {
      const workerId = readWorkerId(request);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const runId = readRunId(body.runId, 'runId');
      const queue = new JobQueueService(pool);
      const result = await queue.heartbeat(runId, workerId);
      if (!result.renewed) {
        return reply.status(409).send({
          code: ErrorCodes.RUN_NOT_RECOVERABLE,
          error: 'Lease 未被续约（worker 不持有该 run 的 lease）',
        });
      }
      return { runId, workerId, renewed: true };
    } catch (err) {
      if (err instanceof AiDirectHiringError) {
        return reply.status(err.httpStatus).send(errorResponse(err));
      }
      throw err;
    }
  });

  // GET /workers/lease — claim next run
  fastify.get('/workers/lease', async (request: any, reply) => {
    try {
      const workerId = readWorkerId(request);
      const queue = new JobQueueService(pool);
      const next = await queue.leaseNext(workerId);
      if (!next) {
        return reply.status(204).send();
      }
      return next;
    } catch (err) {
      if (err instanceof AiDirectHiringError) {
        return reply.status(err.httpStatus).send(errorResponse(err));
      }
      throw err;
    }
  });

  // POST /workers/complete — report step completion or failure
  fastify.post('/workers/complete', async (request: any, reply) => {
    try {
      const workerId = readWorkerId(request);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const runId = readRunId(body.runId, 'runId');
      const sequence = readSequence(body.sequence);
      const status = body.status === 'failed' ? 'failed' : 'succeeded';

      const queue = new JobQueueService(pool);
      if (status === 'failed') {
        const code = typeof body.failureCode === 'string' ? body.failureCode : 'WORKER_REPORTED_FAILURE';
        const reason = typeof body.failureReason === 'string' ? body.failureReason : undefined;
        await queue.failStep(runId, sequence, { code, reason });
        return { runId, sequence, status: 'failed' };
      }

      const output = {
        outputSummary:
          typeof body.outputSummary === 'object' && body.outputSummary !== null
            ? (body.outputSummary as Record<string, unknown>)
            : undefined,
        tokenUsage:
          typeof body.tokenUsage === 'object' && body.tokenUsage !== null
            ? (body.tokenUsage as Record<string, unknown>)
            : undefined,
        costMicros: typeof body.costMicros === 'number' ? body.costMicros : undefined,
        latencyMs: typeof body.latencyMs === 'number' ? body.latencyMs : undefined,
      };
      const { runCompleted } = await queue.completeStep(runId, sequence, output);
      return { runId, sequence, status: 'succeeded', runCompleted, workerId };
    } catch (err) {
      if (err instanceof AiDirectHiringError) {
        return reply.status(err.httpStatus).send(errorResponse(err));
      }
      throw err;
    }
  });
}