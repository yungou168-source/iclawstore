import { describe, expect, it, vi } from 'bun:test';
import type { Pool } from 'mysql2/promise';
import type { CredentialStore } from '../src/contracts/credentialStore.js';
import type { CredentialLease, ModelProvider } from '../src/contracts/modelProvider.js';
import { decideProviderFailure } from '../src/services/jobQueue.js';
import {
  assertProviderBudget,
  calculateProviderCostMicros,
  parseProviderBudget,
  parseProviderPricing,
} from '../src/services/providerCost.js';
import type { ProviderExecutionDescriptor } from '../src/services/providerExecutionDescriptor.js';
import { ProviderExecutionError } from '../src/services/providerErrors.js';
import { createProviderRateLimiter } from '../src/services/providerRateLimiter.js';
import { createJinshaProvider } from '../src/services/jinshaProvider.js';
import { createProviderRegistry } from '../src/services/providerRegistry.js';
import { createWorkerExecutor } from '../src/services/workerExecutor.js';
import { createWorkerRuntimeClient, type WorkerRuntimeClient } from '../src/services/workerRuntimeClient.js';

const pricing = parseProviderPricing({
  currency: 'USD',
  inputMicrosPerMillionTokens: 1_000_000,
  outputMicrosPerMillionTokens: 2_000_000,
});

function descriptor(timeoutMs = 1_000): ProviderExecutionDescriptor {
  return {
    runId: 'run-1',
    stepId: 'step-1',
    sequence: 1,
    attempt: 1,
    stepKey: 'provider.invoke',
    taskType: 'chat',
    agentId: 'agent-1',
    agentVersionId: 'version-1',
    catalogModelId: 'catalog-1',
    providerKey: 'jinsha',
    providerModelKey: 'model-1',
    credentialId: 'credential-1',
    credentialOwnerUserId: 'user-1',
    credentialVersion: 1,
    input: { messages: [{ role: 'user', content: 'hello' }] },
    timeoutMs,
    budget: parseProviderBudget({
      estimatedInputTokens: 5,
      maxOutputTokens: 5,
      maxCostMicros: 20,
    }),
    pricing,
    rateLimit: { requestsPerMinute: 60, tokensPerMinute: 1_000 },
  };
}

function credential(): CredentialLease {
  return {
    credentialId: 'credential-1',
    providerKey: 'jinsha',
    version: 1,
    withSecret: async (consumer) => consumer(Uint8Array.from([1, 2, 3])),
  };
}

function credentialStore(): CredentialStore {
  return {
    saveEncrypted: async () => { throw new Error('not used'); },
    metadata: async () => null,
    metadataForProvider: async () => null,
    lease: async () => credential(),
    rotate: async () => { throw new Error('not used'); },
    rewrap: async () => false,
    markValidation: async () => true,
    revoke: async () => false,
  };
}

function lease() {
  return {
    runId: 'run-1',
    organizationId: 'organization-1',
    agentVersionId: 'version-1',
    requestedByUserId: 'user-1',
    workflowKey: 'provider.workflow',
    status: 'active' as const,
    stepCount: 1,
    currentStep: {
      stepId: 'step-1',
      stepKey: 'provider.invoke',
      sequence: 1,
      status: 'running' as const,
      attempt: 1,
      maxAttempts: 3,
      metadata: {},
    },
    startedAt: new Date(),
    finishedAt: null,
    payload: {},
  };
}

describe('provider cost policy', () => {
  it('calculates rounded-up token cost and rejects an insufficient maximum budget', () => {
    expect(calculateProviderCostMicros(pricing, 3, 2)).toBe(7n);
    expect(() => assertProviderBudget(pricing, parseProviderBudget({
      estimatedInputTokens: 5,
      maxOutputTokens: 5,
      maxCostMicros: 14,
    }))).toThrow('cost budget');
  });
});

describe('provider failure decision', () => {
  it('retries transient failures with bounded backoff and terminates permanent or exhausted failures', () => {
    const retry = decideProviderFailure({
      runId: 'run-1',
      stepId: 'step-1',
      attempt: 1,
      maxAttempts: 3,
      failureClass: 'rate_limit',
      retryAfterMs: 4_000,
      now: 1_000,
    });
    expect(retry.retryScheduled).toBe(true);
    expect(retry.runAfter!.getTime()).toBeGreaterThanOrEqual(5_000);
    expect(decideProviderFailure({
      runId: 'run-1', stepId: 'step-1', attempt: 1, maxAttempts: 3,
      failureClass: 'auth', now: 1_000,
    })).toEqual({ retryScheduled: false, runAfter: null });
    expect(decideProviderFailure({
      runId: 'run-1', stepId: 'step-1', attempt: 3, maxAttempts: 3,
      failureClass: 'timeout', now: 1_000,
    })).toEqual({ retryScheduled: false, runAfter: null });
  });
});

describe('provider rate limiter', () => {
  it('reserves RPM and TPM from one provider/model bucket', async () => {
    let now = 0;
    const waits: number[] = [];
    const limiter = createProviderRateLimiter(
      () => now,
      async (milliseconds) => {
        waits.push(milliseconds);
        now += milliseconds;
      },
    );
    const signal = new AbortController().signal;
    await limiter.acquire('jinsha', 'model-1', 10, { requestsPerMinute: 1, tokensPerMinute: 10 }, signal);
    await limiter.acquire('jinsha', 'model-1', 10, { requestsPerMinute: 1, tokensPerMinute: 10 }, signal);
    expect(waits).toEqual([60_000]);
  });
});

describe('single-concurrency worker executor', () => {
  it('executes one leased step and reports catalog-priced usage metadata', async () => {
    const completed = vi.fn(async () => undefined);
    const failed = vi.fn(async () => undefined);
    const client: WorkerRuntimeClient = {
      leaseProvider: async () => lease(),
      heartbeat: async () => true,
      complete: completed,
      fail: failed,
    };
    const provider: ModelProvider = {
      key: 'jinsha',
      listModels: async () => [],
      validateCredential: async () => ({ valid: true }),
      executeStep: async () => ({
        outputSummary: { content: 'ok' },
        providerRequestId: 'request-1',
        inputTokens: 3,
        outputTokens: 2,
        latencyMs: 12,
      }),
      health: async () => ({ status: 'available', checkedAt: new Date() }),
    };
    const executor = createWorkerExecutor({
      pool: {} as Pool,
      client,
      credentialStore: credentialStore(),
      providers: createProviderRegistry([provider]),
      rateLimiter: createProviderRateLimiter(),
      config: { workerId: 'worker-1', pollIntervalMs: 100, heartbeatIntervalMs: 1_000 },
      resolveDescriptor: async () => descriptor(),
    });

    await expect(executor.runOnce(new AbortController().signal)).resolves.toBe('processed');
    expect(failed).not.toHaveBeenCalled();
    expect(completed).toHaveBeenCalledTimes(1);
    expect(completed.mock.calls[0]![0]).toMatchObject({
      inputTokens: 3,
      outputTokens: 2,
      costMicros: 7,
      modelAudit: {
        catalogModelId: 'catalog-1',
        credentialVersion: 1,
        providerRequestId: 'request-1',
      },
    });
  });

  it('crosses the Worker and Provider HTTP boundaries without exposing the credential', async () => {
    const workerToken = `adw_${'a'.repeat(43)}`;
    const reports: Array<Record<string, unknown>> = [];
    let providerAuthorization: string | null = null;
    const mock = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: async (request) => {
        const url = new URL(request.url);
        if (url.pathname === '/api/v1/ai-direct-hiring/workers/lease') {
          expect(url.searchParams.get('capability')).toBe('provider');
          expect(request.headers.get('authorization')).toBe(`Bearer ${workerToken}`);
          return Response.json(lease());
        }
        if (url.pathname === '/api/v1/ai-direct-hiring/workers/complete') {
          reports.push(await request.json() as Record<string, unknown>);
          return new Response(null, { status: 204 });
        }
        if (url.pathname === '/v1/chat/completions') {
          providerAuthorization = request.headers.get('authorization');
          const body = await request.json() as Record<string, unknown>;
          expect(body).toMatchObject({ model: 'model-1', max_tokens: 5, stream: false });
          return Response.json({
            id: 'provider-request-http-1',
            choices: [{ message: { content: 'http-ok' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 3, completion_tokens: 2 },
          });
        }
        return new Response(null, { status: 404 });
      },
    });

    const apiKey = 'test-jinsha-key';
    const httpCredentialStore: CredentialStore = {
      ...credentialStore(),
      lease: async () => ({
        credentialId: 'credential-1',
        providerKey: 'jinsha',
        version: 1,
        withSecret: async (consumer) => {
          const secret = new TextEncoder().encode(apiKey);
          try {
            return await consumer(secret);
          } finally {
            secret.fill(0);
          }
        },
      }),
    };

    try {
      const localOrigin = mock.url.origin;
      const provider = createJinshaProvider({
        baseUrl: 'https://jinsha.invalid',
        transport: (url, init) => fetch(`${localOrigin}${new URL(url).pathname}`, init),
      });
      const executor = createWorkerExecutor({
        pool: {} as Pool,
        client: createWorkerRuntimeClient({
          baseUrl: localOrigin,
          workerId: 'executor-http-1',
          workerToken,
        }),
        credentialStore: httpCredentialStore,
        providers: createProviderRegistry([provider]),
        rateLimiter: createProviderRateLimiter(),
        config: { workerId: 'executor-http-1', pollIntervalMs: 100, heartbeatIntervalMs: 1_000 },
        resolveDescriptor: async () => descriptor(),
      });

      await expect(executor.runOnce(new AbortController().signal)).resolves.toBe('processed');
      expect(providerAuthorization).toBe(`Bearer ${apiKey}`);
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({
        status: 'succeeded',
        tokenUsage: { inputTokens: 3, outputTokens: 2 },
        costMicros: 7,
      });
      expect(JSON.stringify(reports)).not.toContain(apiKey);
    } finally {
      mock.stop(true);
    }
  });

  it('reports typed timeout failures without reporting completion', async () => {
    const completed = vi.fn(async () => undefined);
    const failed = vi.fn(async () => undefined);
    const provider: ModelProvider = {
      key: 'jinsha',
      listModels: async () => [],
      validateCredential: async () => ({ valid: true }),
      executeStep: async (input) => new Promise((_resolve, reject) => {
        input.signal.addEventListener('abort', () => reject(new ProviderExecutionError(
          'timeout',
          'timed out',
        )), { once: true });
      }),
      health: async () => ({ status: 'available', checkedAt: new Date() }),
    };
    const executor = createWorkerExecutor({
      pool: {} as Pool,
      client: {
        leaseProvider: async () => lease(),
        heartbeat: async () => true,
        complete: completed,
        fail: failed,
      },
      credentialStore: credentialStore(),
      providers: createProviderRegistry([provider]),
      rateLimiter: createProviderRateLimiter(),
      config: { workerId: 'worker-1', pollIntervalMs: 100, heartbeatIntervalMs: 1_000 },
      resolveDescriptor: async () => descriptor(10),
    });

    await executor.runOnce(new AbortController().signal);
    expect(completed).not.toHaveBeenCalled();
    expect(failed.mock.calls[0]![0]).toMatchObject({
      failureCode: 'PROVIDER_TIMEOUT',
      failureClass: 'timeout',
    });
  });
});