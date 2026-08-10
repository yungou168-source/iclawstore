import { describe, expect, it } from "bun:test";
import type {
  CredentialLease,
  ModelProvider,
  StepExecutionInput,
} from "../src/contracts/modelProvider.js";
import { createJinshaProvider } from "../src/services/jinshaProvider.js";
import { ProviderExecutionError } from "../src/services/providerErrors.js";
import { createProviderRegistry } from "../src/services/providerRegistry.js";

function credential(): CredentialLease {
  let consumed = false;
  return {
    credentialId: "credential-1",
    providerKey: "jinsha",
    version: 1,
    withSecret: async (consumer) => {
      if (consumed) throw new Error("consumed");
      consumed = true;
      const secret = Uint8Array.from([116, 101, 115, 116, 45, 116, 111, 107, 101, 110]);
      try {
        return await consumer(secret);
      } finally {
        secret.fill(0);
      }
    },
  };
}

function executionInput(lease = credential()): StepExecutionInput {
  return {
    runId: "run-1",
    stepId: "step-1",
    stepKey: "invoke.model",
    modelKey: "model-1",
    input: {
      messages: [{ role: "user", content: "hello" }],
      maxTokens: 16,
      temperature: 0.2,
    },
    credential: lease,
    signal: new AbortController().signal,
  };
}

function stubProvider(key: string): ModelProvider {
  return {
    key,
    listModels: async () => [],
    validateCredential: async () => ({ valid: true }),
    executeStep: async () => ({ outputSummary: {} }),
    health: async () => ({ status: "available", checkedAt: new Date() }),
  };
}

describe("provider registry", () => {
  it("resolves explicit providers and rejects duplicates or unknown keys", () => {
    const provider = stubProvider("jinsha");
    const registry = createProviderRegistry([provider]);

    expect(registry.keys).toEqual(["jinsha"]);
    expect(registry.resolve("jinsha")).toBe(provider);
    expect(registry.resolve("unknown")).toBeNull();
    expect(() => registry.require("unknown")).toThrow(ProviderExecutionError);
    expect(() => createProviderRegistry([provider, provider])).toThrow("Duplicate provider key");
  });
});

describe("Jinsha OpenAI-compatible provider", () => {
  it("uses only the fixed chat endpoint and strictly maps content, usage, and request ID", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const provider = createJinshaProvider({
      baseUrl: "https://jinsha.invalid",
      transport: async (url, init) => {
        requests.push({ url, init });
        return Response.json(
          {
            id: "request-body-id",
            choices: [{ message: { role: "assistant", content: "answer" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
          },
          { headers: { "x-request-id": "request-header-id" } },
        );
      },
    });

    const result = await provider.executeStep(executionInput());

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://jinsha.invalid/v1/chat/completions");
    expect(requests[0]!.init.redirect).toBe("manual");
    expect(JSON.parse(String(requests[0]!.init.body))).toMatchObject({
      model: "model-1",
      stream: false,
      max_tokens: 16,
    });
    expect(result).toMatchObject({
      outputSummary: { content: "answer", finishReason: "stop" },
      providerRequestId: "request-header-id",
      inputTokens: 7,
      outputTokens: 3,
    });
  });

  it("lists models with a credential but never exposes request-level URL overrides", async () => {
    const provider = createJinshaProvider({
      baseUrl: "https://jinsha.invalid",
      transport: async (url) => {
        expect(url).toBe("https://jinsha.invalid/v1/models");
        return Response.json({ data: [{ id: "model-a" }, { id: "model-b" }] });
      },
    });

    await expect(provider.listModels(credential())).resolves.toEqual([
      {
        providerKey: "jinsha",
        modelKey: "model-a",
        displayName: "model-a",
        capabilities: ["chat.completions"],
      },
      {
        providerKey: "jinsha",
        modelKey: "model-b",
        displayName: "model-b",
        capabilities: ["chat.completions"],
      },
    ]);
  });

  it("classifies rate limits and preserves bounded Retry-After metadata", async () => {
    const provider = createJinshaProvider({
      baseUrl: "https://jinsha.invalid",
      transport: async () =>
        Response.json(
          { error: { type: "rate_limit_error" } },
          { status: 429, headers: { "retry-after": "2" } },
        ),
    });

    try {
      await provider.executeStep(executionInput());
      throw new Error("expected provider failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderExecutionError);
      expect(error).toMatchObject({
        failureClass: "rate_limit",
        code: "PROVIDER_RATE_LIMITED",
        providerStatus: 429,
        retryAfterMs: 2000,
      });
    }
  });

  it("rejects redirects, malformed success bodies, and non-origin base URLs", async () => {
    expect(() => createJinshaProvider({ baseUrl: "http://jinsha.invalid" })).toThrow(
      "HTTPS origin",
    );
    expect(() => createJinshaProvider({ baseUrl: "https://jinsha.invalid/proxy" })).toThrow(
      "HTTPS origin",
    );

    const redirecting = createJinshaProvider({
      baseUrl: "https://jinsha.invalid",
      transport: async () =>
        new Response(null, { status: 302, headers: { location: "https://other.invalid" } }),
    });
    await expect(redirecting.executeStep(executionInput())).rejects.toMatchObject({
      failureClass: "protocol",
    });

    const malformed = createJinshaProvider({
      baseUrl: "https://jinsha.invalid",
      transport: async () => Response.json({ choices: [], usage: {} }),
    });
    await expect(malformed.executeStep(executionInput())).rejects.toMatchObject({
      failureClass: "protocol",
    });
  });

  it("classifies transport aborts as timeout without leaking transport errors", async () => {
    const provider = createJinshaProvider({
      baseUrl: "https://jinsha.invalid",
      timeoutMs: 100,
      transport: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("transport detail")), {
            once: true,
          });
        }),
    });

    await expect(provider.executeStep(executionInput())).rejects.toMatchObject({
      failureClass: "timeout",
      message: "Provider request was aborted or timed out",
    });
  });
});
