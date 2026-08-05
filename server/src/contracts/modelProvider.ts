export type ProviderFailureClass =
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'provider_5xx'
  | 'quota'
  | 'invalid_request'
  | 'model_unavailable'
  | 'protocol'
  | 'budget_exceeded'
  | 'provider_unavailable';

export type ProviderHealth =
  | { status: 'available'; checkedAt: Date; latencyMs?: number }
  | { status: 'unavailable'; checkedAt: Date; reason: string };

export type ProviderModel = {
  providerKey: string;
  modelKey: string;
  displayName: string;
  capabilities: readonly string[];
  contextWindow?: number;
  inputMimeTypes?: readonly string[];
  outputMimeTypes?: readonly string[];
};

export type CredentialLease = {
  credentialId: string;
  providerKey: string;
  version: number;
  withSecret: <T>(consumer: (secret: Uint8Array) => Promise<T>) => Promise<T>;
};

export type StepExecutionInput = {
  runId: string;
  stepId: string;
  stepKey: string;
  modelKey: string;
  input: Readonly<Record<string, unknown>>;
  credential: CredentialLease | null;
  signal: AbortSignal;
};

export type StepExecutionOutput = {
  outputSummary: Readonly<Record<string, unknown>>;
  providerRequestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  costMicros?: bigint;
  latencyMs?: number;
  artifacts?: readonly {
    kind: string;
    storagePath: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
  }[];
};

export type ModelProvider = Readonly<{
  key: string;
  listModels: (credential: CredentialLease) => Promise<readonly ProviderModel[]>;
  validateCredential: (credential: CredentialLease) => Promise<{ valid: boolean; reason?: string }>;
  executeStep: (input: StepExecutionInput) => Promise<StepExecutionOutput>;
  health: () => Promise<ProviderHealth>;
}>;

export type ModelProviderResolver = (providerKey: string) => ModelProvider | null;