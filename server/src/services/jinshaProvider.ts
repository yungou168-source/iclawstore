import type {
  CredentialLease,
  ModelProvider,
  ProviderModel,
  StepExecutionInput,
  StepExecutionOutput,
} from "../contracts/modelProvider.js";
import { ProviderExecutionError } from "./providerErrors.js";

export type ProviderHttpTransport = (url: string, init: RequestInit) => Promise<Response>;

export type JinshaProviderConfig = Readonly<{
  baseUrl: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  transport?: ProviderHttpTransport;
}>;

type ChatMessage = Readonly<{
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}>;

const PROVIDER_KEY = "jinsha";
const MAX_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Jinsha numeric configuration must be between ${min} and ${max}`);
  }
  return value;
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Jinsha base URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error(
      "Jinsha base URL must be an HTTPS origin without credentials, path, query, or fragment",
    );
  }
  return url.origin;
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProviderExecutionError("protocol", `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ProviderExecutionError("protocol", `${label} must be a non-negative integer`);
  }
  return value as number;
}

function optionalRequestId(response: Response, body: Record<string, unknown>): string | undefined {
  const value = response.headers.get("x-request-id") ?? body.id;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length < 1 || value.length > 191) {
    throw new ProviderExecutionError("protocol", "Provider request ID is invalid");
  }
  return value;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.min(Math.ceil(seconds * 1000), 3_600_000);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.min(Math.max(0, timestamp - Date.now()), 3_600_000);
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body?.cancel();
    throw new ProviderExecutionError(
      "protocol",
      "Provider response exceeds the configured size limit",
    );
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new ProviderExecutionError(
          "protocol",
          "Provider response exceeds the configured size limit",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function decodeJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch (error) {
    throw new ProviderExecutionError("protocol", "Provider returned malformed JSON", {
      cause: error,
    });
  }
}

function providerErrorBody(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const outer = value as Record<string, unknown>;
  if (!outer.error || typeof outer.error !== "object" || Array.isArray(outer.error)) return null;
  return outer.error as Record<string, unknown>;
}

function classifyHttpFailure(
  response: Response,
  body: unknown,
  operation: "models" | "chat",
): never {
  const status = response.status;
  const error = providerErrorBody(body);
  const errorCode = typeof error?.code === "string" ? error.code.toLowerCase() : "";
  const errorType = typeof error?.type === "string" ? error.type.toLowerCase() : "";
  if (status === 401 || status === 403) {
    throw new ProviderExecutionError("auth", "Provider rejected the credential", {
      providerStatus: status,
    });
  }
  if (
    status === 402 ||
    errorCode.includes("quota") ||
    errorType.includes("quota") ||
    errorCode === "insufficient_quota"
  ) {
    throw new ProviderExecutionError("quota", "Provider quota is unavailable", {
      providerStatus: status,
    });
  }
  if (status === 429) {
    throw new ProviderExecutionError("rate_limit", "Provider rate limit was exceeded", {
      providerStatus: status,
      retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
    });
  }
  if (status >= 500 && status <= 599) {
    throw new ProviderExecutionError("provider_5xx", "Provider is temporarily unavailable", {
      providerStatus: status,
    });
  }
  if (status === 404 && operation === "chat") {
    throw new ProviderExecutionError("model_unavailable", "Provider model is unavailable", {
      providerStatus: status,
    });
  }
  if (status === 400 || status === 404 || status === 409 || status === 422) {
    throw new ProviderExecutionError("invalid_request", "Provider rejected the request", {
      providerStatus: status,
    });
  }
  throw new ProviderExecutionError("protocol", "Provider returned an unexpected HTTP status", {
    providerStatus: status,
  });
}

function parseMessages(input: Readonly<Record<string, unknown>>): readonly ChatMessage[] {
  if (!Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > 256) {
    throw new ProviderExecutionError(
      "invalid_request",
      "Execution input requires 1 to 256 messages",
    );
  }
  return input.messages.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ProviderExecutionError("invalid_request", `messages[${index}] must be an object`);
    }
    const message = value as Record<string, unknown>;
    if (!["system", "user", "assistant", "tool"].includes(String(message.role))) {
      throw new ProviderExecutionError("invalid_request", `messages[${index}].role is invalid`);
    }
    if (typeof message.content !== "string" || message.content.length < 1) {
      throw new ProviderExecutionError("invalid_request", `messages[${index}].content is invalid`);
    }
    return { role: message.role as ChatMessage["role"], content: message.content };
  });
}

function optionalExecutionParameters(
  input: Readonly<Record<string, unknown>>,
): Record<string, number> {
  const parameters: Record<string, number> = {};
  if (input.maxTokens !== undefined) {
    if (!Number.isSafeInteger(input.maxTokens) || (input.maxTokens as number) < 1) {
      throw new ProviderExecutionError("invalid_request", "maxTokens must be a positive integer");
    }
    parameters.max_tokens = input.maxTokens as number;
  }
  if (input.temperature !== undefined) {
    if (
      typeof input.temperature !== "number" ||
      !Number.isFinite(input.temperature) ||
      input.temperature < 0 ||
      input.temperature > 2
    ) {
      throw new ProviderExecutionError("invalid_request", "temperature must be between 0 and 2");
    }
    parameters.temperature = input.temperature;
  }
  return parameters;
}

export function createJinshaProvider(config: JinshaProviderConfig): ModelProvider {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const timeoutMs = boundedInteger(config.timeoutMs, 60_000, 100, MAX_TIMEOUT_MS);
  const maxResponseBytes = boundedInteger(
    config.maxResponseBytes,
    1024 * 1024,
    1024,
    MAX_RESPONSE_BYTES,
  );
  const transport = config.transport ?? ((url, init) => fetch(url, init));

  const requestJson = async (
    credential: CredentialLease,
    operation: "models" | "chat",
    body: Record<string, unknown> | null,
    signal?: AbortSignal,
  ): Promise<{ response: Response; body: Record<string, unknown> }> =>
    credential.withSecret(async (secret) => {
      const tokenBytes = Buffer.from(secret);
      let token: string;
      try {
        token = tokenBytes.toString("utf8");
      } finally {
        tokenBytes.fill(0);
      }
      if (!token || token.length > 4096 || /[^\x21-\x7e]/.test(token)) {
        throw new ProviderExecutionError("auth", "Credential format is invalid");
      }

      const controller = new AbortController();
      const abort = () => controller.abort(signal?.reason);
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => controller.abort(new Error("provider timeout")), timeoutMs);
      try {
        let response: Response;
        try {
          response = await transport(
            `${baseUrl}${operation === "models" ? "/v1/models" : "/v1/chat/completions"}`,
            {
              method: body ? "POST" : "GET",
              redirect: "manual",
              signal: controller.signal,
              headers: {
                accept: "application/json",
                authorization: `Bearer ${token}`,
                ...(body ? { "content-type": "application/json" } : {}),
              },
              body: body ? JSON.stringify(body) : undefined,
            },
          );
        } catch (error) {
          if (controller.signal.aborted) {
            throw new ProviderExecutionError(
              "timeout",
              "Provider request was aborted or timed out",
              { cause: error },
            );
          }
          throw new ProviderExecutionError("network", "Provider network request failed", {
            cause: error,
          });
        }
        if (response.status >= 300 && response.status <= 399) {
          await response.body?.cancel();
          throw new ProviderExecutionError("protocol", "Provider redirects are not allowed", {
            providerStatus: response.status,
          });
        }
        const bytes = await readBoundedBody(response, maxResponseBytes);
        const decoded = bytes.byteLength > 0 ? decodeJson(bytes) : {};
        if (!response.ok) classifyHttpFailure(response, decoded, operation);
        return { response, body: asObject(decoded, "Provider response") };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    });

  const listModels = async (credential: CredentialLease): Promise<readonly ProviderModel[]> => {
    if (credential.providerKey !== PROVIDER_KEY) {
      throw new ProviderExecutionError("auth", "A valid Jinsha credential is required");
    }
    const { body } = await requestJson(credential, "models", null);
    if (!Array.isArray(body.data))
      throw new ProviderExecutionError("protocol", "Provider models data must be an array");
    const seen = new Set<string>();
    return body.data.map((value, index) => {
      const model = asObject(value, `models.data[${index}]`);
      if (
        typeof model.id !== "string" ||
        !model.id ||
        model.id.length > 255 ||
        seen.has(model.id)
      ) {
        throw new ProviderExecutionError("protocol", "Provider model ID is invalid or duplicated");
      }
      seen.add(model.id);
      return {
        providerKey: PROVIDER_KEY,
        modelKey: model.id,
        displayName: model.id,
        capabilities: ["chat.completions"],
      };
    });
  };

  const executeStep = async (input: StepExecutionInput): Promise<StepExecutionOutput> => {
    if (!input.credential || input.credential.providerKey !== PROVIDER_KEY) {
      throw new ProviderExecutionError("auth", "A valid Jinsha credential is required");
    }
    if (!input.modelKey || input.modelKey.length > 255) {
      throw new ProviderExecutionError("model_unavailable", "Jinsha model key is invalid");
    }
    const startedAt = Date.now();
    const { response, body } = await requestJson(
      input.credential,
      "chat",
      {
        model: input.modelKey,
        messages: parseMessages(input.input),
        ...optionalExecutionParameters(input.input),
        stream: false,
      },
      input.signal,
    );
    if (!Array.isArray(body.choices) || body.choices.length < 1) {
      throw new ProviderExecutionError("protocol", "Provider response choices are missing");
    }
    const choice = asObject(body.choices[0], "choices[0]");
    const message = asObject(choice.message, "choices[0].message");
    if (typeof message.content !== "string") {
      throw new ProviderExecutionError("protocol", "Provider response content is invalid");
    }
    if (
      choice.finish_reason !== null &&
      choice.finish_reason !== undefined &&
      typeof choice.finish_reason !== "string"
    ) {
      throw new ProviderExecutionError("protocol", "Provider finish reason is invalid");
    }
    const usage = asObject(body.usage, "usage");
    return {
      outputSummary: {
        content: message.content,
        finishReason: choice.finish_reason ?? null,
      },
      providerRequestId: optionalRequestId(response, body),
      inputTokens: nonNegativeInteger(usage.prompt_tokens, "usage.prompt_tokens"),
      outputTokens: nonNegativeInteger(usage.completion_tokens, "usage.completion_tokens"),
      latencyMs: Date.now() - startedAt,
    };
  };

  const provider: ModelProvider = {
    key: PROVIDER_KEY,
    listModels,
    validateCredential: async (credential) => {
      try {
        await listModels(credential);
        return { valid: true };
      } catch (error) {
        if (error instanceof ProviderExecutionError) {
          return { valid: false, reason: error.failureClass };
        }
        return { valid: false, reason: "network" };
      }
    },
    executeStep,
    health: async () => ({ status: "available", checkedAt: new Date() }),
  };
  return Object.freeze(provider);
}
