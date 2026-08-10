import type { ProviderFailureClass } from "../contracts/modelProvider.js";
import type { RunContext } from "./jobQueue.js";
import type { ModelExecutionAuditInput } from "./jobQueue.js";

export type WorkerCompletion = Readonly<{
  runId: string;
  sequence: number;
  outputSummary: Readonly<Record<string, unknown>>;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  latencyMs: number;
  modelAudit: ModelExecutionAuditInput;
}>;

export type WorkerFailure = Readonly<{
  runId: string;
  sequence: number;
  failureCode: string;
  failureClass: ProviderFailureClass;
  retryAfterMs?: number;
  modelAudit?: ModelExecutionAuditInput;
}>;

export type WorkerRuntimeClient = Readonly<{
  leaseProvider: (signal: AbortSignal) => Promise<RunContext | null>;
  heartbeat: (runId: string, signal: AbortSignal) => Promise<boolean>;
  complete: (result: WorkerCompletion, signal: AbortSignal) => Promise<void>;
  fail: (failure: WorkerFailure, signal: AbortSignal) => Promise<void>;
}>;

export type WorkerRuntimeClientConfig = Readonly<{
  baseUrl: string;
  workerId: string;
  workerToken: string;
  transport?: typeof fetch;
}>;

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  const loopback =
    url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (
    (!loopback && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Worker API base URL must be HTTPS or loopback HTTP without credentials");
  }
  if (url.pathname !== "/" && url.pathname !== "")
    throw new Error("Worker API base URL must be an origin");
  return url.origin;
}

function validWorkerIdentity(workerId: string, workerToken: string): void {
  if (!workerId || workerId.length > 128) throw new Error("WORKER_ID is invalid");
  if (!/^adw_[A-Za-z0-9_-]{43}$/.test(workerToken)) throw new Error("WORKER_TOKEN is invalid");
}

export function createWorkerRuntimeClient(config: WorkerRuntimeClientConfig): WorkerRuntimeClient {
  validWorkerIdentity(config.workerId, config.workerToken);
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const transport = config.transport ?? fetch;
  const request = async (
    path: string,
    init: RequestInit,
    signal: AbortSignal,
  ): Promise<Response> => {
    const response = await transport(`${baseUrl}/api/v1/ai-direct-hiring${path}`, {
      ...init,
      signal,
      redirect: "manual",
      headers: {
        authorization: `Bearer ${config.workerToken}`,
        "x-worker-id": config.workerId,
        "content-type": "application/json",
        ...init.headers,
      },
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error("Worker API redirect was rejected");
    }
    return response;
  };
  const expectSuccess = async (response: Response): Promise<void> => {
    if (response.ok) {
      await response.body?.cancel();
      return;
    }
    await response.body?.cancel();
    throw new Error(`Worker API request failed with status ${response.status}`);
  };

  return Object.freeze({
    leaseProvider: async (signal) => {
      const response = await request(
        "/workers/lease?capability=provider",
        { method: "GET" },
        signal,
      );
      if (response.status === 204) return null;
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Worker lease failed with status ${response.status}`);
      }
      return (await response.json()) as RunContext;
    },
    heartbeat: async (runId, signal) => {
      const response = await request(
        "/workers/heartbeat",
        {
          method: "POST",
          body: JSON.stringify({ runId }),
        },
        signal,
      );
      if (response.status === 409) {
        await response.body?.cancel();
        return false;
      }
      await expectSuccess(response);
      return true;
    },
    complete: async (result, signal) => {
      await expectSuccess(
        await request(
          "/workers/complete",
          {
            method: "POST",
            body: JSON.stringify({
              runId: result.runId,
              sequence: result.sequence,
              status: "succeeded",
              outputSummary: result.outputSummary,
              tokenUsage: {
                inputTokens: result.inputTokens,
                outputTokens: result.outputTokens,
              },
              costMicros: result.costMicros,
              latencyMs: result.latencyMs,
              modelAudit: result.modelAudit,
            }),
          },
          signal,
        ),
      );
    },
    fail: async (failure, signal) => {
      await expectSuccess(
        await request(
          "/workers/complete",
          {
            method: "POST",
            body: JSON.stringify({
              runId: failure.runId,
              sequence: failure.sequence,
              status: "failed",
              failureCode: failure.failureCode,
              failureClass: failure.failureClass,
              retryAfterMs: failure.retryAfterMs,
              modelAudit: failure.modelAudit,
            }),
          },
          signal,
        ),
      );
    },
  });
}
