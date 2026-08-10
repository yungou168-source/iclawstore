import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { CredentialLease } from "../contracts/modelProvider.js";
import { requireAuth } from "../middleware/aiDirectAuth.js";
import { AiDirectHiringError, ErrorCodes, errorResponse } from "../services/aiDirectErrors.js";
import { encryptCredential, fingerprintCredential } from "../services/credentialVault.js";
import { CredentialWriteConflictError } from "../services/mysqlCredentialStore.js";
import type { ProviderRuntime } from "../services/providerRuntime.js";

const PROVIDER_KEY = "jinsha";
const LABEL = "金沙";
const MAX_API_KEY_LENGTH = 4096;

type CredentialResponse = Readonly<{
  configured: boolean;
  providerKey: typeof PROVIDER_KEY;
  id?: string;
  label?: string;
  version?: number;
  validationStatus?: "unvalidated" | "valid" | "invalid";
  validatedAt?: Date | null;
  lastUsedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}>;

function readApiKey(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "请求正文必须是对象");
  }
  const values = body as Record<string, unknown>;
  if (Object.keys(values).some((key) => key !== "apiKey")) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "只允许提交 apiKey");
  }
  if (typeof values.apiKey !== "string") {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "apiKey 必须是字符串");
  }
  const apiKey = values.apiKey.trim();
  if (apiKey.length < 8 || apiKey.length > MAX_API_KEY_LENGTH || /[\r\n]/.test(apiKey)) {
    throw new AiDirectHiringError(ErrorCodes.CREDENTIAL_INVALID, "金沙 Key 格式不正确");
  }
  return apiKey;
}

function temporaryLease(secret: Uint8Array): CredentialLease {
  let consumed = false;
  return {
    credentialId: "credential-validation",
    providerKey: PROVIDER_KEY,
    version: 1,
    withSecret: async (consumer) => {
      if (consumed) throw new Error("Credential validation lease has already been consumed");
      consumed = true;
      try {
        return await consumer(secret);
      } finally {
        secret.fill(0);
      }
    },
  };
}

function responseFor(
  metadata: Awaited<ReturnType<ProviderRuntime["credentialStore"]["metadataForProvider"]>>,
): CredentialResponse {
  if (!metadata || metadata.status !== "active") {
    return { configured: false, providerKey: PROVIDER_KEY };
  }
  return {
    configured: true,
    providerKey: PROVIDER_KEY,
    id: metadata.id,
    label: metadata.label,
    version: metadata.version,
    validationStatus: metadata.validationStatus,
    validatedAt: metadata.validatedAt,
    lastUsedAt: metadata.lastUsedAt,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
  };
}

export function createAiDirectCredentialRoutes(runtime: ProviderRuntime) {
  return async function aiDirectCredentialRoutes(fastify: FastifyInstance): Promise<void> {
    const auth = [(fastify as any).authenticate];

    fastify.get("/credentials/jinsha", { onRequest: auth }, async (request, reply) => {
      try {
        const user = await requireAuth(fastify, request);
        const current = await runtime.credentialStore.metadataForProvider(user.id, PROVIDER_KEY);
        return reply.status(200).send(responseFor(current));
      } catch (error) {
        if (error instanceof AiDirectHiringError) {
          return reply.status(error.httpStatus).send(errorResponse(error));
        }
        throw error;
      }
    });

    fastify.put("/credentials/jinsha", { onRequest: auth }, async (request, reply) => {
      try {
        const user = await requireAuth(fastify, request);
        const apiKey = readApiKey(request.body);
        const validationSecret = Buffer.from(apiKey, "utf8");
        const provider = runtime.providers.require(PROVIDER_KEY);
        let validation: Awaited<ReturnType<typeof provider.validateCredential>>;
        try {
          validation = await provider.validateCredential(temporaryLease(validationSecret));
        } finally {
          validationSecret.fill(0);
        }
        if (!validation.valid) {
          throw new AiDirectHiringError(ErrorCodes.CREDENTIAL_INVALID, "金沙 Key 验证失败", 400, {
            reason: validation.reason ?? "invalid",
          });
        }

        const current = await runtime.credentialStore.metadataForProvider(user.id, PROVIDER_KEY);
        const credentialId = current?.id ?? randomUUID();
        const version = (current?.version ?? 0) + 1;
        const secret = Buffer.from(apiKey, "utf8");
        try {
          const context = {
            credentialId,
            ownerUserId: user.id,
            providerKey: PROVIDER_KEY,
            credentialVersion: version,
          };
          const envelope = encryptCredential(runtime.keyring, context, secret);
          const fingerprint = fingerprintCredential(runtime.keyring, secret);
          const saved = current
            ? await runtime.credentialStore.rotate(
                credentialId,
                user.id,
                version,
                envelope,
                fingerprint,
              )
            : await runtime.credentialStore.saveEncrypted({
                id: credentialId,
                ownerUserId: user.id,
                providerKey: PROVIDER_KEY,
                label: LABEL,
                fingerprint,
                version,
                envelope,
              });
          return reply.status(200).send(responseFor(saved));
        } finally {
          secret.fill(0);
        }
      } catch (error) {
        if (error instanceof AiDirectHiringError) {
          return reply.status(error.httpStatus).send(errorResponse(error));
        }
        if (error instanceof CredentialWriteConflictError) {
          return reply
            .status(409)
            .send(
              errorResponse(
                new AiDirectHiringError(
                  ErrorCodes.DUPLICATE_ENTRY,
                  "凭据已被并发更新，请重试",
                  409,
                ),
              ),
            );
        }
        throw error;
      }
    });

    fastify.delete("/credentials/jinsha", { onRequest: auth }, async (request, reply) => {
      try {
        const user = await requireAuth(fastify, request);
        const current = await runtime.credentialStore.metadataForProvider(user.id, PROVIDER_KEY);
        if (current?.status === "active") {
          await runtime.credentialStore.revoke(current.id, user.id);
        }
        return reply.status(204).send();
      } catch (error) {
        if (error instanceof AiDirectHiringError) {
          return reply.status(error.httpStatus).send(errorResponse(error));
        }
        throw error;
      }
    });
  };
}
