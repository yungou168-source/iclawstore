import type { ProviderFailureClass } from '../contracts/modelProvider.js';

const FAILURE_CODES: Readonly<Record<ProviderFailureClass, string>> = Object.freeze({
  auth: 'PROVIDER_AUTH_FAILED',
  rate_limit: 'PROVIDER_RATE_LIMITED',
  timeout: 'PROVIDER_TIMEOUT',
  network: 'PROVIDER_NETWORK_FAILED',
  provider_5xx: 'PROVIDER_UPSTREAM_FAILED',
  quota: 'PROVIDER_QUOTA_EXCEEDED',
  invalid_request: 'PROVIDER_REQUEST_INVALID',
  model_unavailable: 'PROVIDER_MODEL_UNAVAILABLE',
  protocol: 'PROVIDER_PROTOCOL_INVALID',
  budget_exceeded: 'PROVIDER_BUDGET_EXCEEDED',
  provider_unavailable: 'PROVIDER_UNAVAILABLE',
});

export class ProviderExecutionError extends Error {
  readonly code: string;
  readonly failureClass: ProviderFailureClass;
  readonly retryAfterMs?: number;
  readonly providerStatus?: number;

  constructor(
    failureClass: ProviderFailureClass,
    message: string,
    options: Readonly<{
      retryAfterMs?: number;
      providerStatus?: number;
      cause?: unknown;
    }> = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ProviderExecutionError';
    this.code = FAILURE_CODES[failureClass];
    this.failureClass = failureClass;
    this.retryAfterMs = options.retryAfterMs;
    this.providerStatus = options.providerStatus;
  }
}

export function isProviderExecutionError(error: unknown): error is ProviderExecutionError {
  return error instanceof ProviderExecutionError;
}