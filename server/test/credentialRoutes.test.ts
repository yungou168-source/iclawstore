import { describe, expect, it } from "bun:test";
import Fastify from "fastify";
import type {
  CredentialMetadata,
  CredentialStore,
  SaveEncryptedCredentialInput,
} from "../src/contracts/credentialStore.js";
import type { ModelProvider } from "../src/contracts/modelProvider.js";
import { createAiDirectCredentialRoutes } from "../src/routes/aiDirectCredentials.js";
import type { CredentialKeyring } from "../src/services/credentialKeyring.js";
import { CredentialWriteConflictError } from "../src/services/mysqlCredentialStore.js";
import { createProviderRegistry } from "../src/services/providerRegistry.js";
import type { ProviderRuntime } from "../src/services/providerRuntime.js";

function keyring(): CredentialKeyring {
  return {
    activeVersion: "k1",
    encryptionKeys: new Map([["k1", Uint8Array.from({ length: 32 }, (_, index) => index + 1)]]),
    fingerprintKey: Uint8Array.from({ length: 32 }, (_, index) => 255 - index),
  };
}

function metadata(input: SaveEncryptedCredentialInput): CredentialMetadata {
  const now = new Date();
  return {
    id: input.id,
    ownerUserId: input.ownerUserId,
    providerKey: input.providerKey,
    label: input.label,
    fingerprint: input.fingerprint,
    version: input.version,
    keyVersion: input.envelope.keyVersion,
    status: "active",
    validationStatus: "valid",
    validatedAt: now,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
    revokedAt: null,
  };
}

function runtimeFixture() {
  let current: CredentialMetadata | null = null;
  let validatedSecret = "";
  const store: CredentialStore = {
    saveEncrypted: async (input) => {
      current = metadata(input);
      return current;
    },
    metadata: async (id, ownerUserId) =>
      current?.id === id && current.ownerUserId === ownerUserId ? current : null,
    metadataForProvider: async (ownerUserId, providerKey) =>
      current?.ownerUserId === ownerUserId && current.providerKey === providerKey ? current : null,
    lease: async () => null,
    rotate: async (id, ownerUserId, version, envelope, fingerprint) => {
      if (
        !current ||
        current.id !== id ||
        current.ownerUserId !== ownerUserId ||
        version !== current.version + 1
      ) {
        throw new CredentialWriteConflictError();
      }
      current = {
        ...current,
        fingerprint,
        version,
        keyVersion: envelope.keyVersion,
        status: "active",
        validationStatus: "valid",
        revokedAt: null,
        updatedAt: new Date(),
      };
      return current;
    },
    rewrap: async () => false,
    markValidation: async () => false,
    revoke: async (id, ownerUserId) => {
      if (
        !current ||
        current.id !== id ||
        current.ownerUserId !== ownerUserId ||
        current.status !== "active"
      ) {
        return false;
      }
      current = {
        ...current,
        status: "revoked",
        validationStatus: "invalid",
        revokedAt: new Date(),
      };
      return true;
    },
  };
  const provider: ModelProvider = {
    key: "jinsha",
    listModels: async () => [],
    validateCredential: async (credential) =>
      credential.withSecret(async (secret) => {
        validatedSecret = Buffer.from(secret).toString("utf8");
        return { valid: true };
      }),
    executeStep: async () => ({ outputSummary: {} }),
    health: async () => ({ status: "available", checkedAt: new Date() }),
  };
  const runtime: ProviderRuntime = {
    credentialStore: store,
    keyring: keyring(),
    providers: createProviderRegistry([provider]),
  };
  return { runtime, readCurrent: () => current, readValidatedSecret: () => validatedSecret };
}

async function appFor(runtime: ProviderRuntime) {
  const app = Fastify();
  app.decorate("authenticate", async (request: unknown) => {
    (request as { user?: { id: string } }).user = { id: "user-1" };
  });
  await app.register(createAiDirectCredentialRoutes(runtime));
  return app;
}

describe("AI Direct credential routes", () => {
  it("validates, encrypts, replaces, reports metadata, and revokes without returning secret fields", async () => {
    const fixture = runtimeFixture();
    const app = await appFor(fixture.runtime);
    try {
      const created = await app.inject({
        method: "PUT",
        url: "/credentials/jinsha",
        payload: { apiKey: "test-api-key-1" },
      });
      expect(created.statusCode).toBe(200);
      expect(created.json()).toMatchObject({ configured: true, providerKey: "jinsha", version: 1 });
      expect(created.body).not.toContain("fingerprint");
      expect(created.body).not.toContain("cipher");
      expect(fixture.readValidatedSecret()).toBe("test-api-key-1");
      expect(fixture.readCurrent()?.fingerprint).toMatch(/^[a-f0-9]{64}$/);

      const replaced = await app.inject({
        method: "PUT",
        url: "/credentials/jinsha",
        payload: { apiKey: "test-api-key-2" },
      });
      expect(replaced.json()).toMatchObject({ configured: true, version: 2 });

      const fetched = await app.inject({ method: "GET", url: "/credentials/jinsha" });
      expect(fetched.json()).toMatchObject({ configured: true, version: 2 });

      const removed = await app.inject({ method: "DELETE", url: "/credentials/jinsha" });
      expect(removed.statusCode).toBe(204);
      const afterDelete = await app.inject({ method: "GET", url: "/credentials/jinsha" });
      expect(afterDelete.json()).toEqual({ configured: false, providerKey: "jinsha" });
    } finally {
      await app.close();
    }
  });

  it("rejects extra fields before contacting the provider", async () => {
    const fixture = runtimeFixture();
    const app = await appFor(fixture.runtime);
    try {
      const response = await app.inject({
        method: "PUT",
        url: "/credentials/jinsha",
        payload: { apiKey: "test-api-key-1", baseUrl: "https://attacker.invalid" },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
      expect(fixture.readValidatedSecret()).toBe("");
    } finally {
      await app.close();
    }
  });
});
