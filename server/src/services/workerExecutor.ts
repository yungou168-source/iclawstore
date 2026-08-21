import type { Pool } from "mysql2/promise";
import type { CredentialStore } from "../contracts/credentialStore.js";
import { assertProviderBudget, calculateProviderCostMicros } from "./providerCost.js";
import { ProviderExecutionError, isProviderExecutionError } from "./providerErrors.js";
import type { ProviderExecutionDescriptor } from "./providerExecutionDescriptor.js";
import { resolveProviderExecutionDescriptor } from "./providerExecutionDescriptor.js";
import type { ProviderRateLimiter } from "./providerRateLimiter.js";
import type { ProviderRegistry } from "./providerRegistry.js";
import type { WorkerRuntimeClient } from "./workerRuntimeClient.js";

export type WorkerExecutorConfig = Readonly<{
  workerId: string;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
}>;

export type WorkerExecutor = Readonly<{
  runOnce: (signal: AbortSignal) => Promise<"idle" | "processed">;
  run: (signal: AbortSignal) => Promise<void>;
}>;

type DescriptorResolver = (
  pool: Pool,
  runId: string,
  stepId: string,
  workerId: string,
) => Promise<ProviderExecutionDescriptor>;

function abortableSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new Error("Executor stopped"));
    const timer = setTimeout(done, milliseconds);
    function done() {
      signal.removeEventListener("abort", aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Executor stopped"));
    }
    signal.addEventListener("abort", aborted, { once: true });
  });
}

function boundedInteger(value: number, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function reportSignal(milliseconds = 10_000): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("Worker report timed out")),
    milliseconds,
  );
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function executionError(error: unknown): ProviderExecutionError {
  if (isProviderExecutionError(error)) return error;
  if (error instanceof Error && error.message.includes("cost budget")) {
    return new ProviderExecutionError(
      "budget_exceeded",
      "Provider execution exceeds the approved budget",
    );
  }
  return new ProviderExecutionError("invalid_request", "Provider execution descriptor is invalid");
}

function auditFor(
  descriptor: ProviderExecutionDescriptor,
  input: {
    providerRequestId?: string;
    inputTokens?: number;
    outputTokens?: number;
    costMicros?: number;
    latencyMs?: number;
  },
) {
  return {
    agentId: descriptor.agentId,
    agentVersionId: descriptor.agentVersionId,
    catalogModelId: descriptor.catalogModelId,
    modelKey: descriptor.providerModelKey,
    providerKey: descriptor.providerKey,
    credentialVersion: descriptor.credentialVersion,
    providerRequestId: input.providerRequestId,
    attempt: descriptor.attempt,
    taskType: descriptor.taskType,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    costMicros: input.costMicros,
    latencyMs: input.latencyMs,
    routingMetadata: {
      source: "approved_catalog",
      pricingCurrency: descriptor.pricing.currency,
    },
  } as const;
}

export function createWorkerExecutor(
  dependencies: Readonly<{
    pool: Pool;
    client: WorkerRuntimeClient;
    credentialStore: CredentialStore;
    providers: ProviderRegistry;
    rateLimiter: ProviderRateLimiter;
    config: WorkerExecutorConfig;
    resolveDescriptor?: DescriptorResolver;
  }>,
): WorkerExecutor {
  const pollIntervalMs = boundedInteger(
    dependencies.config.pollIntervalMs,
    "pollIntervalMs",
    100,
    60_000,
  );
  const heartbeatIntervalMs = boundedInteger(
    dependencies.config.heartbeatIntervalMs,
    "heartbeatIntervalMs",
    1_000,
    30_000,
  );
  const resolveDescriptor = dependencies.resolveDescriptor ?? resolveProviderExecutionDescriptor;

  const runOnce = async (signal: AbortSignal): Promise<"idle" | "processed"> => {
    const lease = await dependencies.client.leaseProvider(signal);
    if (!lease) return "idle";
    const stepController = new AbortController();
    const abortStep = () => stepController.abort(signal.reason ?? new Error("Executor stopped"));
    signal.addEventListener("abort", abortStep, { once: true });
    let heartbeatRunning = false;
    const heartbeat = setInterval(async () => {
      if (heartbeatRunning || stepController.signal.aborted) return;
      heartbeatRunning = true;
      try {
        const renewed = await dependencies.client.heartbeat(lease.runId, stepController.signal);
        if (!renewed) stepController.abort(new Error("Worker lease was lost"));
      } catch {
        stepController.abort(new Error("Worker heartbeat failed"));
      } finally {
        heartbeatRunning = false;
      }
    }, heartbeatIntervalMs);

    let descriptor: ProviderExecutionDescriptor | undefined;
    try {
      descriptor = await resolveDescriptor(
        dependencies.pool,
        lease.runId,
        lease.currentStep.stepId,
        dependencies.config.workerId,
      );
      assertProviderBudget(descriptor.pricing, descriptor.budget);
      await dependencies.rateLimiter.acquire(
        descriptor.providerKey,
        descriptor.providerModelKey,
        Math.max(1, descriptor.budget.estimatedInputTokens + descriptor.budget.maxOutputTokens),
        descriptor.rateLimit,
        stepController.signal,
      );
      const credential = await dependencies.credentialStore.lease(
        descriptor.credentialId,
        descriptor.credentialOwnerUserId,
      );
      if (!credential || credential.version !== descriptor.credentialVersion) {
        throw new ProviderExecutionError("auth", "A valid provider credential is required");
      }

      const provider = dependencies.providers.require(descriptor.providerKey);
      const timeout = setTimeout(
        () => stepController.abort(new Error("Provider step timed out")),
        descriptor.timeoutMs,
      );
      const startedAt = Date.now();
      try {
        const result = await provider.executeStep({
          runId: descriptor.runId,
          stepId: descriptor.stepId,
          stepKey: descriptor.stepKey,
          modelKey: descriptor.providerModelKey,
          input: Object.freeze({
            ...descriptor.input,
            maxTokens: descriptor.budget.maxOutputTokens,
          }),
          credential,
          signal: stepController.signal,
        });
        const inputTokens = result.inputTokens ?? 0;
        const outputTokens = result.outputTokens ?? 0;
        const cost = calculateProviderCostMicros(descriptor.pricing, inputTokens, outputTokens);
        if (cost > descriptor.budget.maxCostMicros || cost > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new ProviderExecutionError(
            "budget_exceeded",
            "Provider execution exceeded the approved budget",
          );
        }
        const latencyMs = result.latencyMs ?? Date.now() - startedAt;
        const costMicros = Number(cost);
        const completionReport = reportSignal();
        try {
          await dependencies.client.complete(
            {
              runId: descriptor.runId,
              sequence: descriptor.sequence,
              outputSummary: result.outputSummary,
              inputTokens,
              outputTokens,
              costMicros,
              latencyMs,
              modelAudit: auditFor(descriptor, {
                providerRequestId: result.providerRequestId,
                inputTokens,
                outputTokens,
                costMicros,
                latencyMs,
              }),
            },
            completionReport.signal,
          );
        } finally {
          completionReport.clear();
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      const failure = executionError(error);
      if (descriptor && failure.failureClass === "auth") {
        await dependencies.credentialStore
          .markValidation(descriptor.credentialId, descriptor.credentialOwnerUserId, "invalid")
          .catch(() => false);
      }
      const failureReport = reportSignal();
      try {
        await dependencies.client.fail(
          {
            runId: lease.runId,
            sequence: lease.currentStep.sequence,
            failureCode: failure.code,
            failureClass: failure.failureClass,
            retryAfterMs: failure.retryAfterMs,
            modelAudit: descriptor ? auditFor(descriptor, {}) : undefined,
          },
          failureReport.signal,
        );
      } finally {
        failureReport.clear();
      }
    } finally {
      clearInterval(heartbeat);
      signal.removeEventListener("abort", abortStep);
      if (!stepController.signal.aborted) stepController.abort(new Error("Provider step finished"));
    }
    return "processed";
  };

  const run = async (signal: AbortSignal): Promise<void> => {
    while (!signal.aborted) {
      const result = await runOnce(signal);
      if (result === "idle") await abortableSleep(pollIntervalMs, signal);
    }
  };

  return Object.freeze({ runOnce, run });
}
