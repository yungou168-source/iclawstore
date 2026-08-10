import type { Pool } from "mysql2/promise";
import type { ProviderBudget, ProviderPricing } from "./providerCost.js";
import { parseProviderBudget, parseProviderPricing } from "./providerCost.js";
import type { ProviderRateLimit } from "./providerRateLimiter.js";

export type ProviderExecutionDescriptor = Readonly<{
  runId: string;
  stepId: string;
  sequence: number;
  attempt: number;
  stepKey: string;
  taskType: string;
  agentId: string;
  agentVersionId: string;
  catalogModelId: string;
  providerKey: string;
  providerModelKey: string;
  credentialId: string;
  credentialOwnerUserId: string;
  credentialVersion: number;
  input: Readonly<Record<string, unknown>>;
  timeoutMs: number;
  budget: ProviderBudget;
  pricing: ProviderPricing;
  rateLimit: ProviderRateLimit;
}>;

type ExecutionMetadata = {
  kind?: unknown;
  taskType?: unknown;
  input?: unknown;
  timeoutMs?: unknown;
  budget?: unknown;
  rateLimit?: unknown;
};

function object(value: unknown, field: string): Record<string, unknown> {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${field} must be an object`);
  }
  return parsed as Record<string, unknown>;
}

function text(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value || value.length > maximum) {
    throw new Error(`${field} is invalid`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${field} must be between 1 and ${maximum}`);
  }
  return value;
}

function modelIdForTask(policyValue: unknown, taskType: string): string {
  const policy = object(policyValue, "modelPolicy");
  const overrides =
    policy.taskOverrides === undefined
      ? {}
      : object(policy.taskOverrides, "modelPolicy.taskOverrides");
  return text(overrides[taskType] ?? policy.defaultModelId, "resolved catalog model ID", 36);
}

export async function resolveProviderExecutionDescriptor(
  pool: Pool,
  runId: string,
  stepId: string,
  workerId: string,
): Promise<ProviderExecutionDescriptor> {
  const [contextRows] = await pool.query(
    `SELECT r.id AS runId, r.agentVersionId, r.requestedByUserId,
            s.id AS stepId, s.sequence, s.stepKey, s.attemptCount, s.metadata,
            v.agentId, v.status AS agentVersionStatus, v.modelPolicy
     FROM ai_direct_workflow_runs r
     JOIN ai_direct_workflow_run_steps s ON s.runId = r.id
     JOIN ai_direct_agent_versions v ON v.id = r.agentVersionId
     WHERE r.id = ? AND s.id = ? AND r.status = 'active' AND r.leaseOwner = ?
       AND r.leaseExpiresAt > NOW(3) AND s.status = 'running'
     LIMIT 1`,
    [runId, stepId, workerId],
  );
  const context = (contextRows as Array<Record<string, unknown>>)[0];
  if (!context) throw new Error("Provider execution context is unavailable");
  if (context.agentVersionStatus !== "published") {
    throw new Error("Provider execution requires a published agent version");
  }

  const stepMetadata = object(context.metadata, "step metadata");
  const execution = object(
    stepMetadata.providerExecution,
    "step metadata.providerExecution",
  ) as ExecutionMetadata;
  if (execution.kind !== "provider") throw new Error("Step is not a provider execution step");
  const taskType = text(execution.taskType, "providerExecution.taskType", 128);
  const catalogModelId = modelIdForTask(context.modelPolicy, taskType);

  const [modelRows] = await pool.query(
    `SELECT id, providerKey, providerModelKey, status, pricing
     FROM ai_direct_model_catalog WHERE id = ? LIMIT 1`,
    [catalogModelId],
  );
  const model = (modelRows as Array<Record<string, unknown>>)[0];
  if (
    !model ||
    model.status !== "approved" ||
    typeof model.providerKey !== "string" ||
    typeof model.providerModelKey !== "string"
  ) {
    throw new Error("Approved provider model mapping is unavailable");
  }

  const ownerUserId = text(context.requestedByUserId, "requestedByUserId", 191);
  const [credentialRows] = await pool.query(
    `SELECT id, credentialVersion
     FROM ai_direct_user_credentials
     WHERE userId = ? AND provider = ? AND validationStatus = 'valid' AND revokedAt IS NULL
     LIMIT 1`,
    [ownerUserId, model.providerKey],
  );
  const credential = (credentialRows as Array<Record<string, unknown>>)[0];
  if (!credential) throw new Error("A valid provider credential is unavailable");

  const rateLimitValue = object(execution.rateLimit, "providerExecution.rateLimit");
  return Object.freeze({
    runId: text(context.runId, "runId", 36),
    stepId: text(context.stepId, "stepId", 36),
    sequence: positiveInteger(context.sequence, "sequence", 1000),
    attempt: positiveInteger(context.attemptCount, "attemptCount", 1000),
    stepKey: text(context.stepKey, "stepKey", 128),
    taskType,
    agentId: text(context.agentId, "agentId", 36),
    agentVersionId: text(context.agentVersionId, "agentVersionId", 36),
    catalogModelId,
    providerKey: text(model.providerKey, "providerKey", 64),
    providerModelKey: text(model.providerModelKey, "providerModelKey", 255),
    credentialId: text(credential.id, "credentialId", 36),
    credentialOwnerUserId: ownerUserId,
    credentialVersion: positiveInteger(
      credential.credentialVersion,
      "credentialVersion",
      2_147_483_647,
    ),
    input: Object.freeze(object(execution.input, "providerExecution.input")),
    timeoutMs: positiveInteger(execution.timeoutMs, "providerExecution.timeoutMs", 120_000),
    budget: parseProviderBudget(execution.budget),
    pricing: parseProviderPricing(model.pricing),
    rateLimit: Object.freeze({
      requestsPerMinute: positiveInteger(
        rateLimitValue.requestsPerMinute,
        "providerExecution.rateLimit.requestsPerMinute",
        60_000,
      ),
      tokensPerMinute: positiveInteger(
        rateLimitValue.tokensPerMinute,
        "providerExecution.rateLimit.tokensPerMinute",
        100_000_000,
      ),
    }),
  });
}
