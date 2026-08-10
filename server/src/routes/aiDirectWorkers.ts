/**
 * AI Direct Hiring — Worker Interface Routes (P1 Runtime Center, Agent G).
 *
 * Endpoints (worker-facing, scoped to internal worker tokens):
 *   POST /workers/heartbeat        — refresh lease on a leased run
 *   GET  /workers/lease            — claim the next queued run
 *   POST /workers/complete         — mark a step + (optionally) the run done
 *
 * Auth: organization-scoped worker tokens are hashed at rest, bound to
 * `X-Worker-Id`, revocable, expirable, and issued only by organization admins.
 * Lease and completion queries additionally enforce the token organization
 * and current lease owner; gateway restrictions are defense in depth only.
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

import { FastifyInstance } from "fastify";
import type { ProviderFailureClass } from "../contracts/modelProvider.js";
import { AiDirectHiringError, ErrorCodes, errorResponse } from "../services/aiDirectErrors.js";
import {
  JobQueueService,
  type ArtifactInput,
  type ModelExecutionAuditInput,
} from "../services/jobQueue.js";
import { authenticateWorker } from "../services/workerTokens.js";

function readRunId(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 36) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 必须是 1-36 字符的 ID`);
  }
  return value;
}

function readSequence(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 1000) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "sequence 必须是 1-1000 之间的整数");
  }
  return value;
}

function readTokenUsage(
  value: unknown,
): { inputTokens?: number; outputTokens?: number } | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "tokenUsage 必须是对象");
  }
  const usage = value as Record<string, unknown>;
  const readCount = (field: "inputTokens" | "outputTokens"): number | undefined => {
    const count = usage[field];
    if (count === undefined) return undefined;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
      throw new AiDirectHiringError(
        ErrorCodes.VALIDATION_ERROR,
        `tokenUsage.${field} 必须是非负整数`,
      );
    }
    return count;
  };
  return { inputTokens: readCount("inputTokens"), outputTokens: readCount("outputTokens") };
}

const FAILURE_CLASSES = new Set<ProviderFailureClass>([
  "auth",
  "rate_limit",
  "timeout",
  "network",
  "provider_5xx",
  "quota",
  "invalid_request",
  "model_unavailable",
  "protocol",
  "budget_exceeded",
  "provider_unavailable",
]);

function readFailureClass(value: unknown): ProviderFailureClass {
  if (typeof value !== "string" || !FAILURE_CLASSES.has(value as ProviderFailureClass)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "failureClass 无效");
  }
  return value as ProviderFailureClass;
}

function readOptionalInteger(
  value: unknown,
  field: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 必须是非负整数`);
  }
  return value;
}

function readRequiredInteger(value: unknown, field: string, maximum: number): number {
  const result = readOptionalInteger(value, field, maximum);
  if (result === undefined || result < 1) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 必须是正整数`);
  }
  return result;
}

function readModelAudit(value: unknown): ModelExecutionAuditInput | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "modelAudit 必须是对象");
  }
  const audit = value as Record<string, unknown>;
  const text = (field: string, maximum: number): string => {
    const result = audit[field];
    if (typeof result !== "string" || !result || result.length > maximum) {
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `modelAudit.${field} 无效`);
    }
    return result;
  };
  const routingMetadata =
    audit.routingMetadata === undefined
      ? undefined
      : audit.routingMetadata &&
          typeof audit.routingMetadata === "object" &&
          !Array.isArray(audit.routingMetadata)
        ? (audit.routingMetadata as Record<string, unknown>)
        : (() => {
            throw new AiDirectHiringError(
              ErrorCodes.VALIDATION_ERROR,
              "modelAudit.routingMetadata 无效",
            );
          })();
  return {
    agentId: text("agentId", 36),
    agentVersionId: text("agentVersionId", 36),
    catalogModelId: text("catalogModelId", 36),
    modelKey: text("modelKey", 255),
    providerKey: text("providerKey", 64),
    credentialVersion: readRequiredInteger(
      audit.credentialVersion,
      "modelAudit.credentialVersion",
      2_147_483_647,
    ),
    providerRequestId:
      audit.providerRequestId === undefined ? undefined : text("providerRequestId", 191),
    attempt: readRequiredInteger(audit.attempt, "modelAudit.attempt", 1000),
    taskType: text("taskType", 128),
    inputTokens: readOptionalInteger(audit.inputTokens, "modelAudit.inputTokens"),
    outputTokens: readOptionalInteger(audit.outputTokens, "modelAudit.outputTokens"),
    costMicros: readOptionalInteger(audit.costMicros, "modelAudit.costMicros"),
    latencyMs: readOptionalInteger(audit.latencyMs, "modelAudit.latencyMs", 120_000),
    routingMetadata,
  };
}

function readArtifacts(value: unknown): ArtifactInput[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 20) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "artifacts 必须是最多 20 项的数组");
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `artifacts[${index}] 必须是对象`);
    }
    const artifact = item as Record<string, unknown>;
    const readText = (field: string, max: number): string => {
      const text = artifact[field];
      if (typeof text !== "string" || !text || text.length > max) {
        throw new AiDirectHiringError(
          ErrorCodes.VALIDATION_ERROR,
          `artifacts[${index}].${field} 无效`,
        );
      }
      return text;
    };
    const storagePath = readText("storagePath", 1024);
    if (storagePath.startsWith("/") || storagePath.includes("..") || storagePath.includes("\\")) {
      throw new AiDirectHiringError(
        ErrorCodes.VALIDATION_ERROR,
        `artifacts[${index}].storagePath 必须是安全的相对对象路径`,
      );
    }
    const sha256 = readText("sha256", 64).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha256)) {
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `artifacts[${index}].sha256 无效`);
    }
    const sizeBytes = artifact.sizeBytes;
    if (typeof sizeBytes !== "number" || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
      throw new AiDirectHiringError(
        ErrorCodes.VALIDATION_ERROR,
        `artifacts[${index}].sizeBytes 无效`,
      );
    }
    const visibility = artifact.visibility ?? "organization";
    if (visibility !== "organization" && visibility !== "requester") {
      throw new AiDirectHiringError(
        ErrorCodes.VALIDATION_ERROR,
        `artifacts[${index}].visibility 无效`,
      );
    }
    return {
      kind: readText("kind", 64),
      storagePath,
      mimeType: readText("mimeType", 255),
      sizeBytes,
      sha256,
      visibility,
    };
  });
}

export async function aiDirectWorkersRoutes(fastify: FastifyInstance) {
  const pool = (fastify as any).mysql;

  // POST /workers/heartbeat — refresh lease
  fastify.post("/workers/heartbeat", async (request: any, reply) => {
    try {
      const identity = await authenticateWorker(pool, request.headers);
      const workerId = identity.workerId;
      const body = (request.body ?? {}) as Record<string, unknown>;
      const runId = readRunId(body.runId, "runId");
      const queue = new JobQueueService(pool);
      const result = await queue.heartbeat(runId, workerId);
      if (!result.renewed) {
        return reply.status(409).send({
          code: ErrorCodes.RUN_NOT_RECOVERABLE,
          error: "Lease 未被续约（worker 不持有该 run 的 lease）",
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
  fastify.get("/workers/lease", async (request: any, reply) => {
    try {
      const identity = await authenticateWorker(pool, request.headers);
      const workerId = identity.workerId;
      const queue = new JobQueueService(pool);
      const capability = request.query?.capability === "provider" ? "provider" : "general";
      const next = await queue.leaseNext(workerId, identity.organizationId, capability);
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
  fastify.post("/workers/complete", async (request: any, reply) => {
    try {
      const identity = await authenticateWorker(pool, request.headers);
      const workerId = identity.workerId;
      const body = (request.body ?? {}) as Record<string, unknown>;
      const runId = readRunId(body.runId, "runId");
      const sequence = readSequence(body.sequence);
      const status = body.status === "failed" ? "failed" : "succeeded";

      const queue = new JobQueueService(pool);
      if (status === "failed") {
        const code =
          typeof body.failureCode === "string" && body.failureCode.length <= 128
            ? body.failureCode
            : "WORKER_REPORTED_FAILURE";
        const reason =
          typeof body.failureReason === "string" ? body.failureReason.slice(0, 1000) : undefined;
        const modelAudit = readModelAudit(body.modelAudit);
        const result = await queue.failStep(runId, sequence, workerId, {
          code,
          reason,
          failureClass: readFailureClass(body.failureClass),
          retryAfterMs: readOptionalInteger(body.retryAfterMs, "retryAfterMs", 3_600_000),
          modelAudit,
        });
        return { runId, sequence, status: "failed", ...result };
      }

      const output = {
        outputSummary:
          typeof body.outputSummary === "object" && body.outputSummary !== null
            ? (body.outputSummary as Record<string, unknown>)
            : undefined,
        tokenUsage: readTokenUsage(body.tokenUsage),
        costMicros: readOptionalInteger(body.costMicros, "costMicros"),
        latencyMs: readOptionalInteger(body.latencyMs, "latencyMs", 120_000),
        artifacts: readArtifacts(body.artifacts),
        modelAudit: readModelAudit(body.modelAudit),
      };
      const { runCompleted, nextStep } = await queue.completeStep(
        runId,
        sequence,
        workerId,
        output,
      );
      return { runId, sequence, status: "succeeded", runCompleted, nextStep, workerId };
    } catch (err) {
      if (err instanceof AiDirectHiringError) {
        return reply.status(err.httpStatus).send(errorResponse(err));
      }
      if (err instanceof Error) {
        return reply.status(409).send({
          code: ErrorCodes.RUN_NOT_RECOVERABLE,
          error: err.message,
        });
      }
      throw err;
    }
  });
}
