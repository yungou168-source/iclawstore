import { createHash, randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";
import { AiDirectHiringError, ErrorCodes, errorResponse } from "../services/aiDirectErrors.js";
import { encryptCredential } from "../services/credentialVault.js";
import { listJinshaModels } from "../services/jinshaGateway.js";
import {
  CatalogModel,
  parseModelPolicy,
  resolveModelPolicy,
  validateModelPolicy,
} from "../services/jinshaModelPolicy.js";
import { publishOutboxEvent } from "../utils/outbox.js";
import { aiDirectApprovalsRoutes } from "./aiDirectApprovals.js";
import { aiDirectCapabilitiesRoutes } from "./aiDirectCapabilities.js";
import { aiDirectCompaniesRoutes } from "./aiDirectCompanies.js";
import { aiDirectEmploymentsRoutes } from "./aiDirectEmployments.js";
import { aiDirectJobsRoutes } from "./aiDirectJobs.js";
import { aiDirectOffersRoutes } from "./aiDirectOffers.js";
import { aiDirectWorkersRoutes } from "./aiDirectWorkers.js";

// ─── Shared helpers ────────────────────────────────────────────────────────────

function requestId(request: { headers: Record<string, unknown> }): string {
  const value = request.headers["x-request-id"];
  return typeof value === "string" && value.length > 0 && value.length <= 128
    ? value
    : randomUUID();
}

function idempotencyKey(request: { headers: Record<string, unknown> }): string | null {
  const value = request.headers["idempotency-key"];
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    throw new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      "Idempotency-Key 长度必须为 1 到 128",
    );
  }
  return value;
}

function createFingerprint(fingerprint: string, idempotencyKey: string): string {
  return createHash("sha256").update(JSON.stringify({ fingerprint, idempotencyKey })).digest("hex");
}

function readBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "请求体必须是对象");
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 必须是字符串`);
  }
  const result = value.trim();
  if (!result || result.length > maxLength) {
    throw new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      `${field} 长度必须为 1 到 ${maxLength}`,
    );
  }
  return result;
}

function readObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiDirectHiringError(ErrorCodes.MODEL_POLICY_NO_MATCH, `${field} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function rejectExtraFields(body: Record<string, unknown>, allowed: string[], caller: string): void {
  const extra = Object.keys(body).filter((k) => !allowed.includes(k));
  if (extra.length > 0) {
    throw new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      `${caller} 不接受以下字段: ${extra.join(", ")}`,
      400,
      { extraFields: extra },
    );
  }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function getCatalogModels(pool: any, ids?: string[]): Promise<CatalogModel[]> {
  if (ids?.length) {
    const [rows] = await pool.query(
      `SELECT id, modelKey, displayName, status, capabilities, taskProfile, evidenceVersion
       FROM ai_direct_model_catalog WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    return rows as CatalogModel[];
  }
  const [rows] = await pool.query(
    `SELECT id, modelKey, displayName, status, capabilities, taskProfile, evidenceVersion
     FROM ai_direct_model_catalog WHERE status = 'approved' ORDER BY displayName ASC`,
  );
  return rows as CatalogModel[];
}

async function assertAgentAccess(pool: any, agentId: string, userId: string): Promise<void> {
  const [rows] = await pool.query(
    `SELECT a.id FROM ai_direct_agents a
     LEFT JOIN publisherMembers pm ON pm.publisherId = a.ownerPublisherId AND pm.userId = ?
     WHERE a.id = ? AND (a.ownerUserId = ? OR pm.userId IS NOT NULL) LIMIT 1`,
    [userId, agentId, userId],
  );
  const agent = (rows as any[])[0];
  if (!agent)
    throw new AiDirectHiringError(
      ErrorCodes.FORBIDDEN_SCOPE,
      "未找到 Agent，或当前用户没有访问权限",
      403,
    );
}

async function writeAudit(
  connection: any,
  input: {
    organizationId: string | null;
    actorUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    requestId: string;
    outcome?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await connection.query(
    `INSERT INTO ai_direct_audit_events
     (id, organizationId, actorUserId, action, targetType, targetId, requestId, outcome, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      input.organizationId,
      input.actorUserId,
      input.action,
      input.targetType,
      input.targetId,
      input.requestId,
      input.outcome ?? "success",
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );
}

// ─── Route registry ────────────────────────────────────────────────────────────

export async function aiDirectHiringRoutes(fastify: FastifyInstance) {
  const pool = (fastify as any).mysql;
  const auth = [(fastify as any).authenticate];

  // ── Credentials ────────────────────────────────────────────────────────────

  fastify.get("/credentials/jinsha", { onRequest: auth }, async (request: any) => {
    const [rows] = await pool.query(
      `SELECT updatedAt FROM ai_direct_user_credentials
       WHERE userId = ? AND provider = 'jinsha-token' AND revokedAt IS NULL LIMIT 1`,
      [request.user.id],
    );
    const credential = (rows as any[])[0];
    return { configured: Boolean(credential), updatedAt: credential?.updatedAt ?? null };
  });

  fastify.put("/credentials/jinsha", { onRequest: auth }, async (request: any, reply) => {
    const currentIdempotencyKey = idempotencyKey(request);
    const currentRequestId = requestId(request);
    const actorUserId = request.user.id as string;

    try {
      const body = readBody(request.body);
      // Reject any fields other than apiKey — never accept provider, baseUrl, etc.
      rejectExtraFields(body, ["apiKey"], "PUT /credentials/jinsha");

      const apiKey = readString(body.apiKey, "apiKey", 4096);
      if (apiKey.length < 8 || /[\r\n]/.test(apiKey)) {
        throw new AiDirectHiringError(ErrorCodes.CREDENTIAL_INVALID, "金沙 Key 格式不正确");
      }

      // Verify against Jinsha fixed gateway before saving.
      await listJinshaModels(apiKey);
      const encrypted = encryptCredential(apiKey);

      const credentialId = randomUUID();
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        if (currentIdempotencyKey) {
          // Check for replay: same key + same apiKey fingerprint → return replayed.
          const [existing] = await connection.query(
            `SELECT id, updatedAt FROM ai_direct_user_credentials
             WHERE userId = ? AND provider = 'jinsha-token' AND idempotencyKey = ? LIMIT 1`,
            [actorUserId, currentIdempotencyKey],
          );
          const existingRow = (existing as any[])[0];
          if (existingRow) {
            const fingerprint = createHash("sha256").update(apiKey).digest("hex");
            const [storedFingerprint] = await connection.query(
              `SELECT fingerprint FROM ai_direct_user_credential_fingerprints
               WHERE credentialId = ? LIMIT 1`,
              [existingRow.id],
            );
            const storedFp = (storedFingerprint as any[])[0]?.fingerprint;
            if (storedFp === fingerprint) {
              await connection.rollback();
              return reply.status(200).send({
                configured: true,
                updatedAt: existingRow.updatedAt,
                replayed: true,
              });
            } else {
              await connection.rollback();
              return reply.status(409).send({
                code: ErrorCodes.IDEMPOTENCY_KEY_REUSED,
                error: "幂等键已用于不同的创建请求",
              });
            }
          }
        }

        await connection.query(
          `INSERT INTO ai_direct_user_credentials
           (id, userId, provider, cipherText, iv, authTag, keyVersion, idempotencyKey)
           VALUES (?, ?, 'jinsha-token', ?, ?, ?, 'v1', ?)
           ON DUPLICATE KEY UPDATE
             cipherText = VALUES(cipherText), iv = VALUES(iv), authTag = VALUES(authTag),
             keyVersion = 'v1', revokedAt = NULL, updatedAt = NOW(),
             idempotencyKey = COALESCE(idempotencyKey, VALUES(idempotencyKey))`,
          [
            credentialId,
            actorUserId,
            encrypted.cipherText,
            encrypted.iv,
            encrypted.authTag,
            currentIdempotencyKey,
          ],
        );

        await writeAudit(connection, {
          organizationId: null,
          actorUserId,
          action: "credential.saved",
          targetType: "credential",
          targetId: actorUserId,
          requestId: currentRequestId,
          metadata: { provider: "jinsha-token" },
        });

        await publishOutboxEvent(connection, {
          organizationId: null,
          aggregateType: "credential",
          aggregateId: actorUserId,
          eventType: "credential.saved.v1",
          payload: { userId: actorUserId, provider: "jinsha-token" },
        });

        await connection.commit();

        const [updatedRows] = await pool.query(
          `SELECT updatedAt FROM ai_direct_user_credentials
           WHERE userId = ? AND provider = 'jinsha-token' AND revokedAt IS NULL LIMIT 1`,
          [actorUserId],
        );
        const updated = (updatedRows as any[])[0];
        return reply.status(200).send({ configured: true, updatedAt: updated?.updatedAt ?? null });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (err) {
      if (err instanceof AiDirectHiringError) {
        return reply.status(err.httpStatus).send(errorResponse(err));
      }
      if ((err as any)?.code === "ER_DUP_ENTRY" && currentIdempotencyKey) {
        return reply.status(409).send({
          code: ErrorCodes.IDEMPOTENCY_KEY_REUSED,
          error: "幂等键已用于不同的创建请求",
        });
      }
      throw err;
    }
  });

  fastify.delete("/credentials/jinsha", { onRequest: auth }, async (request: any, reply) => {
    const currentRequestId = requestId(request);
    const actorUserId = request.user.id as string;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [rows] = await connection.query(
        `SELECT id FROM ai_direct_user_credentials
         WHERE userId = ? AND provider = 'jinsha-token' AND revokedAt IS NULL LIMIT 1`,
        [actorUserId],
      );
      const existing = (rows as any[])[0];

      await connection.query(
        `UPDATE ai_direct_user_credentials SET revokedAt = NOW()
         WHERE userId = ? AND provider = 'jinsha-token' AND revokedAt IS NULL`,
        [actorUserId],
      );

      if (existing) {
        await writeAudit(connection, {
          organizationId: null,
          actorUserId,
          action: "credential.revoked",
          targetType: "credential",
          targetId: actorUserId,
          requestId: currentRequestId,
          metadata: { provider: "jinsha-token" },
        });

        await publishOutboxEvent(connection, {
          organizationId: null,
          aggregateType: "credential",
          aggregateId: actorUserId,
          eventType: "credential.revoked.v1",
          payload: { userId: actorUserId, provider: "jinsha-token" },
        });
      }

      await connection.commit();
      return reply.status(204).send();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });

  // ── Model Catalog ───────────────────────────────────────────────────────────

  fastify.get("/model-catalog", { onRequest: auth }, async () => {
    return { items: await getCatalogModels(pool) };
  });

  fastify.post("/model-catalog", { onRequest: auth }, async (request: any, reply) => {
    if (request.user.role !== "admin") {
      return reply.status(403).send({
        code: ErrorCodes.FORBIDDEN_SCOPE,
        error: "仅管理员可以维护模型目录",
      });
    }

    try {
      const body = readBody(request.body);
      const modelKey = readString(body.modelKey, "modelKey", 255);
      const displayName = readString(body.displayName, "displayName", 255);
      const status: string = body.status === "approved" ? "approved" : "draft";
      const evidenceVersion =
        body.evidenceVersion !== undefined
          ? readString(body.evidenceVersion, "evidenceVersion", 128)
          : null;
      const capabilities =
        body.capabilities === undefined ? {} : readObject(body.capabilities, "capabilities");
      const taskProfile =
        body.taskProfile === undefined ? {} : readObject(body.taskProfile, "taskProfile");
      const evidence = body.evidence === undefined ? {} : readObject(body.evidence, "evidence");

      if (status === "approved" && !evidenceVersion) {
        throw new AiDirectHiringError(
          ErrorCodes.MODEL_POLICY_NO_MATCH,
          "批准模型必须提供 evidenceVersion",
        );
      }

      const id = randomUUID();
      const currentRequestId = requestId(request);
      const connection = await pool.getConnection();

      try {
        await connection.beginTransaction();
        await connection.query(
          `INSERT INTO ai_direct_model_catalog
           (id, modelKey, displayName, status, capabilities, taskProfile, evidenceVersion, evidence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            modelKey,
            displayName,
            status,
            JSON.stringify(capabilities),
            JSON.stringify(taskProfile),
            evidenceVersion,
            JSON.stringify(evidence),
          ],
        );

        await writeAudit(connection, {
          organizationId: null,
          actorUserId: request.user.id,
          action: "model_catalog.created",
          targetType: "model_catalog",
          targetId: id,
          requestId: currentRequestId,
          metadata: { modelKey, status, evidenceVersion },
        });

        await publishOutboxEvent(connection, {
          organizationId: null,
          aggregateType: "model_catalog",
          aggregateId: id,
          eventType: "model_catalog.upserted.v1",
          payload: { id, modelKey, displayName, status, evidenceVersion },
        });

        await connection.commit();
        return reply.status(201).send({ id, modelKey, displayName, status, evidenceVersion });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (err) {
      if (err instanceof AiDirectHiringError) {
        return reply.status(err.httpStatus).send(errorResponse(err));
      }
      if ((err as any)?.code === "ER_DUP_ENTRY") {
        return reply.status(409).send({
          code: ErrorCodes.DUPLICATE_ENTRY,
          error: "模型标识已存在",
        });
      }
      throw err;
    }
  });

  fastify.post(
    "/model-catalog/:modelId/approve",
    { onRequest: auth },
    async (request: any, reply) => {
      if (request.user.role !== "admin") {
        return reply.status(403).send({
          code: ErrorCodes.FORBIDDEN_SCOPE,
          error: "仅管理员可以维护模型目录",
        });
      }

      try {
        const body = readBody(request.body ?? {});
        const evidenceVersion = readString(body.evidenceVersion, "evidenceVersion", 128);
        const currentRequestId = requestId(request);
        const connection = await pool.getConnection();

        try {
          await connection.beginTransaction();
          const [rows] = await connection.query(
            `SELECT id, modelKey, status FROM ai_direct_model_catalog WHERE id = ? LIMIT 1 FOR UPDATE`,
            [request.params.modelId],
          );
          const model = (rows as any[])[0];
          if (!model) {
            throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "模型不存在", 404);
          }
          if (model.status === "approved") {
            await connection.rollback();
            return reply.status(200).send({ id: model.id, status: model.status, replayed: true });
          }

          await connection.query(
            `UPDATE ai_direct_model_catalog
           SET status = 'approved', evidenceVersion = ?, updatedAt = NOW()
           WHERE id = ?`,
            [evidenceVersion, request.params.modelId],
          );

          await writeAudit(connection, {
            organizationId: null,
            actorUserId: request.user.id,
            action: "model_catalog.approved",
            targetType: "model_catalog",
            targetId: request.params.modelId,
            requestId: currentRequestId,
            metadata: { modelKey: model.modelKey, evidenceVersion },
          });

          await publishOutboxEvent(connection, {
            organizationId: null,
            aggregateType: "model_catalog",
            aggregateId: request.params.modelId,
            eventType: "model_catalog.upserted.v1",
            payload: {
              id: request.params.modelId,
              modelKey: model.modelKey,
              status: "approved",
              evidenceVersion,
            },
          });

          await connection.commit();
          return reply
            .status(200)
            .send({ id: request.params.modelId, status: "approved", evidenceVersion });
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      } catch (err) {
        if (err instanceof AiDirectHiringError) {
          return reply.status(err.httpStatus).send(errorResponse(err));
        }
        throw err;
      }
    },
  );

  fastify.post(
    "/model-catalog/:modelId/disable",
    { onRequest: auth },
    async (request: any, reply) => {
      if (request.user.role !== "admin") {
        return reply.status(403).send({
          code: ErrorCodes.FORBIDDEN_SCOPE,
          error: "仅管理员可以维护模型目录",
        });
      }

      try {
        const currentRequestId = requestId(request);
        const connection = await pool.getConnection();

        try {
          await connection.beginTransaction();
          const [rows] = await connection.query(
            `SELECT id, modelKey, status FROM ai_direct_model_catalog WHERE id = ? LIMIT 1 FOR UPDATE`,
            [request.params.modelId],
          );
          const model = (rows as any[])[0];
          if (!model) {
            throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "模型不存在", 404);
          }
          if (model.status === "disabled") {
            await connection.rollback();
            return reply.status(200).send({ id: model.id, status: model.status, replayed: true });
          }

          await connection.query(
            `UPDATE ai_direct_model_catalog SET status = 'disabled', updatedAt = NOW() WHERE id = ?`,
            [request.params.modelId],
          );

          await writeAudit(connection, {
            organizationId: null,
            actorUserId: request.user.id,
            action: "model_catalog.disabled",
            targetType: "model_catalog",
            targetId: request.params.modelId,
            requestId: currentRequestId,
            metadata: { modelKey: model.modelKey },
          });

          await publishOutboxEvent(connection, {
            organizationId: null,
            aggregateType: "model_catalog",
            aggregateId: request.params.modelId,
            eventType: "model_catalog.upserted.v1",
            payload: { id: request.params.modelId, modelKey: model.modelKey, status: "disabled" },
          });

          await connection.commit();
          return reply.status(200).send({ id: request.params.modelId, status: "disabled" });
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      } catch (err) {
        if (err instanceof AiDirectHiringError) {
          return reply.status(err.httpStatus).send(errorResponse(err));
        }
        throw err;
      }
    },
  );

  // ── Agents ──────────────────────────────────────────────────────────────────

  fastify.get("/agents", { onRequest: auth }, async (request: any) => {
    const [rows] = await pool.query(
      `SELECT DISTINCT a.id, a.name, a.description, a.status, a.ownerPublisherId, a.createdAt, a.updatedAt,
              v.id AS activeVersionId, v.version AS activeVersion
       FROM ai_direct_agents a
       LEFT JOIN publisherMembers pm ON pm.publisherId = a.ownerPublisherId AND pm.userId = ?
       LEFT JOIN ai_direct_agent_versions v ON v.id = a.activeVersionId
       WHERE a.ownerUserId = ? OR pm.userId IS NOT NULL ORDER BY a.updatedAt DESC LIMIT 100`,
      [request.user.id, request.user.id],
    );
    return { items: rows };
  });

  fastify.get("/agents/:agentId/versions", { onRequest: auth }, async (request: any) => {
    await assertAgentAccess(pool, request.params.agentId, request.user.id);
    const [rows] = await pool.query(
      `SELECT id, version, status, modelPolicy, executionPolicy, createdByUserId, publishedAt, createdAt
       FROM ai_direct_agent_versions WHERE agentId = ? ORDER BY version DESC LIMIT 100`,
      [request.params.agentId],
    );
    return { items: rows };
  });

  fastify.get("/agents/:agentId/model-run-audits", { onRequest: auth }, async (request: any) => {
    await assertAgentAccess(pool, request.params.agentId, request.user.id);
    const limit = Math.max(1, Math.min(Number(request.query?.limit ?? 50) || 50, 100));
    const [rows] = await pool.query(
      `SELECT id, agentVersionId, catalogModelId, modelKey, taskType, status, failureCode,
              inputTokens, outputTokens, costMicros, latencyMs, routingMetadata, createdAt
       FROM ai_direct_model_run_audits WHERE agentId = ? ORDER BY createdAt DESC LIMIT ?`,
      [request.params.agentId, limit],
    );
    return { items: rows };
  });

  fastify.post("/agents", { onRequest: auth }, async (request: any, reply) => {
    let createInput: {
      actorUserId: string;
      idempotencyKey: string | null;
      fingerprint: string;
    } | null = null;

    try {
      const body = readBody(request.body);
      const name = readString(body.name, "name", 120);
      const description =
        body.description !== undefined ? readString(body.description, "description", 2000) : null;
      const publisherId =
        body.publisherId !== undefined ? readString(body.publisherId, "publisherId", 36) : null;

      const promptSpec = requireObject(body.promptSpec, "promptSpec");
      const modelPolicy = parseModelPolicy(body.modelPolicy);

      const currentIdempotencyKey = idempotencyKey(request);
      const currentRequestId = requestId(request);
      const actorUserId = request.user.id as string;

      // publisherId must belong to an org the user is a member of.
      if (publisherId) {
        const [memberships] = await pool.query(
          "SELECT 1 FROM publisherMembers WHERE publisherId = ? AND userId = ? LIMIT 1",
          [publisherId, actorUserId],
        );
        if (!(memberships as any[]).length) {
          throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, "当前用户不是该组织成员", 403);
        }
      }

      // Validate model references against the approved catalog.
      const modelIds = [
        modelPolicy.defaultModelId,
        ...Object.values(modelPolicy.taskOverrides ?? {}),
        ...(modelPolicy.fallbackModelIds ?? []),
      ];
      validateModelPolicy(modelPolicy, await getCatalogModels(pool, modelIds));

      const agentId = randomUUID();
      const versionId = randomUUID();
      createInput = {
        actorUserId,
        idempotencyKey: currentIdempotencyKey,
        fingerprint: createHash("sha256")
          .update(JSON.stringify({ name, modelPolicy }))
          .digest("hex"),
      };
      const connection = await pool.getConnection();

      try {
        await connection.beginTransaction();

        if (currentIdempotencyKey) {
          const [existing] = await connection.query(
            `SELECT id FROM ai_direct_agents
             WHERE ownerUserId = ? AND idempotencyKey = ? LIMIT 1`,
            [actorUserId, currentIdempotencyKey],
          );
          const existingRow = (existing as any[])[0];
          if (existingRow) {
            if (createInput.fingerprint !== null) {
              const [fpRows] = await connection.query(
                `SELECT idempotencyFingerprint FROM ai_direct_agents WHERE id = ?`,
                [existingRow.id],
              );
              const storedFp = (fpRows as any[])[0]?.idempotencyFingerprint;
              if (storedFp !== createInput.fingerprint) {
                await connection.rollback();
                return reply.status(409).send({
                  code: ErrorCodes.IDEMPOTENCY_KEY_REUSED,
                  error: "幂等键已用于不同的创建请求",
                });
              }
            }
            await connection.rollback();
            return reply.status(200).send({ id: existingRow.id, status: "draft", replayed: true });
          }
        }

        await connection.query(
          `INSERT INTO ai_direct_agents
           (id, ownerUserId, ownerPublisherId, name, description, status, activeVersionId, idempotencyKey, idempotencyFingerprint)
           VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
          [
            agentId,
            actorUserId,
            publisherId,
            name,
            description,
            versionId,
            currentIdempotencyKey,
            currentIdempotencyKey ? createInput.fingerprint : null,
          ],
        );
        await connection.query(
          `INSERT INTO ai_direct_agent_versions
           (id, agentId, version, status, promptSpec, modelPolicy, executionPolicy, createdByUserId)
           VALUES (?, ?, 1, 'draft', ?, ?, JSON_OBJECT(), ?)`,
          [
            versionId,
            agentId,
            JSON.stringify(promptSpec),
            JSON.stringify(modelPolicy),
            actorUserId,
          ],
        );

        await writeAudit(connection, {
          organizationId: null,
          actorUserId,
          action: "agent.created",
          targetType: "agent",
          targetId: agentId,
          requestId: currentRequestId,
          metadata: { versionId, modelIds, name },
        });

        await publishOutboxEvent(connection, {
          organizationId: null,
          aggregateType: "agent",
          aggregateId: agentId,
          eventType: "agent.created.v1",
          payload: { id: agentId, versionId, name, modelIds },
        });

        await connection.commit();
        return reply.status(201).send({ id: agentId, activeVersionId: versionId, status: "draft" });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (err) {
      if (err instanceof AiDirectHiringError) {
        return reply.status(err.httpStatus).send(errorResponse(err));
      }
      if ((err as any)?.code === "ER_DUP_ENTRY" && createInput?.idempotencyKey) {
        return reply.status(409).send({
          code: ErrorCodes.IDEMPOTENCY_KEY_REUSED,
          error: "幂等键已用于不同的创建请求",
        });
      }
      throw err;
    }
  });

  fastify.post("/agents/:agentId/versions", { onRequest: auth }, async (request: any, reply) => {
    let createInput: {
      actorUserId: string;
      idempotencyKey: string | null;
      fingerprint: string;
    } | null = null;

    try {
      await assertAgentAccess(pool, request.params.agentId, request.user.id);

      const body = readBody(request.body);
      const promptSpec = requireObject(body.promptSpec, "promptSpec");
      const executionPolicy =
        body.executionPolicy === undefined
          ? {}
          : requireObject(body.executionPolicy, "executionPolicy");
      const modelPolicy = parseModelPolicy(body.modelPolicy);

      const currentIdempotencyKey = idempotencyKey(request);
      const currentRequestId = requestId(request);
      const actorUserId = request.user.id as string;

      const modelIds = [
        modelPolicy.defaultModelId,
        ...Object.values(modelPolicy.taskOverrides ?? {}),
        ...(modelPolicy.fallbackModelIds ?? []),
      ];
      validateModelPolicy(modelPolicy, await getCatalogModels(pool, modelIds));

      const versionId = randomUUID();
      createInput = {
        actorUserId,
        idempotencyKey: currentIdempotencyKey,
        fingerprint: createHash("sha256")
          .update(JSON.stringify({ modelPolicy, executionPolicy }))
          .digest("hex"),
      };
      const connection = await pool.getConnection();

      try {
        await connection.beginTransaction();

        if (currentIdempotencyKey) {
          const [existing] = await connection.query(
            `SELECT id, version, agentId FROM ai_direct_agent_versions
             WHERE agentId = ? AND idempotencyKey = ? LIMIT 1`,
            [request.params.agentId, currentIdempotencyKey],
          );
          const existingRow = (existing as any[])[0];
          if (existingRow) {
            if (createInput.fingerprint !== null) {
              const [fpRows] = await connection.query(
                `SELECT idempotencyFingerprint FROM ai_direct_agent_versions WHERE id = ?`,
                [existingRow.id],
              );
              const storedFp = (fpRows as any[])[0]?.idempotencyFingerprint;
              if (storedFp !== createInput.fingerprint) {
                await connection.rollback();
                return reply.status(409).send({
                  code: ErrorCodes.IDEMPOTENCY_KEY_REUSED,
                  error: "幂等键已用于不同的创建请求",
                });
              }
            }
            await connection.rollback();
            return reply.status(200).send({
              id: existingRow.id,
              agentId: existingRow.agentId,
              version: existingRow.version,
              status: "draft",
              replayed: true,
            });
          }
        }

        const [rows] = await connection.query(
          "SELECT COALESCE(MAX(version), 0) AS latestVersion FROM ai_direct_agent_versions WHERE agentId = ? FOR UPDATE",
          [request.params.agentId],
        );
        const version = Number((rows as any[])[0]?.latestVersion ?? 0) + 1;

        await connection.query(
          `INSERT INTO ai_direct_agent_versions
           (id, agentId, version, status, promptSpec, modelPolicy, executionPolicy, createdByUserId, idempotencyKey, idempotencyFingerprint)
           VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
          [
            versionId,
            request.params.agentId,
            version,
            JSON.stringify(promptSpec),
            JSON.stringify(modelPolicy),
            JSON.stringify(executionPolicy),
            actorUserId,
            currentIdempotencyKey,
            currentIdempotencyKey ? createInput.fingerprint : null,
          ],
        );

        await writeAudit(connection, {
          organizationId: null,
          actorUserId,
          action: "agent_version.created",
          targetType: "agent_version",
          targetId: versionId,
          requestId: currentRequestId,
          metadata: { agentId: request.params.agentId, version, modelIds },
        });

        await publishOutboxEvent(connection, {
          organizationId: null,
          aggregateType: "agent_version",
          aggregateId: versionId,
          eventType: "agent_version.created.v1",
          payload: { id: versionId, agentId: request.params.agentId, version, modelIds },
        });

        await connection.commit();
        return reply.status(201).send({
          id: versionId,
          agentId: request.params.agentId,
          version,
          status: "draft",
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (err) {
      if (err instanceof AiDirectHiringError) {
        return reply.status(err.httpStatus).send(errorResponse(err));
      }
      if ((err as any)?.code === "ER_DUP_ENTRY" && createInput?.idempotencyKey) {
        return reply.status(409).send({
          code: ErrorCodes.IDEMPOTENCY_KEY_REUSED,
          error: "幂等键已用于不同的创建请求",
        });
      }
      throw err;
    }
  });

  fastify.post(
    "/agent-versions/:versionId/publish",
    { onRequest: auth },
    async (request: any, reply) => {
      let createInput: {
        actorUserId: string;
        idempotencyKey: string | null;
        fingerprint: string;
      } | null = null;

      try {
        const currentIdempotencyKey = idempotencyKey(request);
        const currentRequestId = requestId(request);
        const actorUserId = request.user.id as string;

        const [rows] = await pool.query(
          "SELECT agentId, modelPolicy, status FROM ai_direct_agent_versions WHERE id = ? LIMIT 1",
          [request.params.versionId],
        );
        const version = (rows as any[])[0];
        if (!version)
          throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "Agent 版本不存在", 404);

        await assertAgentAccess(pool, version.agentId, actorUserId);

        // Idempotent: already published → return 200 without writing anything new.
        if (version.status === "published") {
          return reply
            .status(200)
            .send({ id: request.params.versionId, status: "published", replayed: true });
        }

        // Re-validate the model policy against the current catalog.
        const policy = parseModelPolicy(
          typeof version.modelPolicy === "string"
            ? JSON.parse(version.modelPolicy)
            : version.modelPolicy,
        );
        const modelIds = [
          policy.defaultModelId,
          ...Object.values(policy.taskOverrides ?? {}),
          ...(policy.fallbackModelIds ?? []),
        ];
        validateModelPolicy(policy, await getCatalogModels(pool, modelIds));

        createInput = {
          actorUserId,
          idempotencyKey: currentIdempotencyKey,
          fingerprint: createHash("sha256")
            .update(JSON.stringify({ versionId: request.params.versionId, policy }))
            .digest("hex"),
        };

        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();

          if (currentIdempotencyKey) {
            const [existing] = await connection.query(
              `SELECT id FROM ai_direct_model_run_audits
             WHERE agentVersionId = ? AND idempotencyKey = ? AND status = 'published' LIMIT 1`,
              [request.params.versionId, currentIdempotencyKey],
            );
            const existingRow = (existing as any[])[0];
            if (existingRow) {
              if (createInput.fingerprint !== null) {
                const [fpRows] = await connection.query(
                  `SELECT idempotencyFingerprint FROM ai_direct_model_run_audits WHERE id = ?`,
                  [existingRow.id],
                );
                const storedFp = (fpRows as any[])[0]?.idempotencyFingerprint;
                if (storedFp !== createInput.fingerprint) {
                  await connection.rollback();
                  return reply.status(409).send({
                    code: ErrorCodes.IDEMPOTENCY_KEY_REUSED,
                    error: "幂等键已用于不同的发布请求",
                  });
                }
              }
              await connection.rollback();
              return reply
                .status(200)
                .send({ id: request.params.versionId, status: "published", replayed: true });
            }
          }

          await connection.query(
            "UPDATE ai_direct_agent_versions SET status = 'published', publishedAt = NOW() WHERE id = ?",
            [request.params.versionId],
          );
          await connection.query(
            "UPDATE ai_direct_agents SET activeVersionId = ?, status = 'active' WHERE id = ?",
            [request.params.versionId, version.agentId],
          );

          await writeAudit(connection, {
            organizationId: null,
            actorUserId,
            action: "agent_version.published",
            targetType: "agent_version",
            targetId: request.params.versionId,
            requestId: currentRequestId,
            metadata: { agentId: version.agentId, modelIds },
          });

          await publishOutboxEvent(connection, {
            organizationId: null,
            aggregateType: "agent_version",
            aggregateId: request.params.versionId,
            eventType: "agent_version.published.v1",
            payload: { id: request.params.versionId, agentId: version.agentId, modelIds },
          });

          await connection.commit();
          return reply.status(200).send({ id: request.params.versionId, status: "published" });
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      } catch (err) {
        if (err instanceof AiDirectHiringError) {
          return reply.status(err.httpStatus).send(errorResponse(err));
        }
        if ((err as any)?.code === "ER_DUP_ENTRY" && createInput?.idempotencyKey) {
          return reply.status(409).send({
            code: ErrorCodes.IDEMPOTENCY_KEY_REUSED,
            error: "幂等键已用于不同的发布请求",
          });
        }
        throw err;
      }
    },
  );

  fastify.post(
    "/agents/:agentId/versions/:versionId/archive",
    { onRequest: auth },
    async (request: any, reply) => {
      try {
        const currentRequestId = requestId(request);
        const actorUserId = request.user.id as string;

        const [versionRows] = await pool.query(
          "SELECT id, agentId, status FROM ai_direct_agent_versions WHERE id = ? AND agentId = ? LIMIT 1",
          [request.params.versionId, request.params.agentId],
        );
        const version = (versionRows as any[])[0];
        if (!version) {
          throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "Agent 版本不存在", 404);
        }

        await assertAgentAccess(pool, request.params.agentId, actorUserId);

        if (version.status === "archived") {
          return reply.status(200).send({ id: version.id, status: "archived", replayed: true });
        }

        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          await connection.query(
            "UPDATE ai_direct_agent_versions SET status = 'archived' WHERE id = ?",
            [request.params.versionId],
          );

          await writeAudit(connection, {
            organizationId: null,
            actorUserId,
            action: "agent_version.archived",
            targetType: "agent_version",
            targetId: request.params.versionId,
            requestId: currentRequestId,
            metadata: { agentId: request.params.agentId },
          });

          await publishOutboxEvent(connection, {
            organizationId: null,
            aggregateType: "agent_version",
            aggregateId: request.params.versionId,
            eventType: "agent_version.archived.v1",
            payload: { id: request.params.versionId, agentId: request.params.agentId },
          });

          await connection.commit();
          return reply.status(200).send({ id: request.params.versionId, status: "archived" });
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      } catch (err) {
        if (err instanceof AiDirectHiringError) {
          return reply.status(err.httpStatus).send(errorResponse(err));
        }
        throw err;
      }
    },
  );

  fastify.post(
    "/agents/:agentId/resolve-model",
    { onRequest: auth },
    async (request: any, reply) => {
      try {
        await assertAgentAccess(pool, request.params.agentId, request.user.id);
        const body = request.body ? readBody(request.body) : {};
        const taskType = typeof body.taskType === "string" ? body.taskType : undefined;

        const [rows] = await pool.query(
          `SELECT v.id, v.modelPolicy FROM ai_direct_agents a
         JOIN ai_direct_agent_versions v ON v.id = a.activeVersionId WHERE a.id = ? LIMIT 1`,
          [request.params.agentId],
        );
        const version = (rows as any[])[0];
        if (!version)
          throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "Agent 尚未配置可用版本", 404);

        const policy = parseModelPolicy(
          typeof version.modelPolicy === "string"
            ? JSON.parse(version.modelPolicy)
            : version.modelPolicy,
        );
        const ids = [
          policy.defaultModelId,
          ...Object.values(policy.taskOverrides ?? {}),
          ...(policy.fallbackModelIds ?? []),
        ];
        const model = resolveModelPolicy(policy, await getCatalogModels(pool, ids), taskType);

        const currentRequestId = requestId(request);
        const routingMeta = {
          selectionSource: model.selectionSource,
          evidenceVersion: model.evidenceVersion,
        };

        await pool.query(
          `INSERT INTO ai_direct_model_run_audits
         (id, agentId, agentVersionId, catalogModelId, modelKey, taskType, status, routingMetadata)
         VALUES (?, ?, ?, ?, ?, ?, 'resolved', ?)`,
          [
            randomUUID(),
            request.params.agentId,
            version.id,
            model.catalogModelId,
            model.modelKey,
            taskType ?? null,
            JSON.stringify(routingMeta),
          ],
        );

        return {
          agentVersionId: version.id,
          taskType: taskType ?? null,
          model: {
            catalogModelId: model.catalogModelId,
            modelKey: model.modelKey,
            displayName: model.displayName,
            selectionSource: model.selectionSource,
            evidenceVersion: model.evidenceVersion,
          },
        };
      } catch (err) {
        if (err instanceof AiDirectHiringError) {
          return reply.status(err.httpStatus).send(errorResponse(err));
        }
        throw err;
      }
    },
  );

  // ── P2 Routes ───────────────────────────────────────────────────────────────
  // Companies, Projects, Roles (Agent B / F)
  await fastify.register(aiDirectCompaniesRoutes);
  // Offers with state machine (Agent F)
  await fastify.register(aiDirectOffersRoutes);
  // Employments with state machine (Agent F)
  await fastify.register(aiDirectEmploymentsRoutes);
  // Approvals with state machine (Agent F)
  await fastify.register(aiDirectApprovalsRoutes);
  // Capability Grants (Agent F)
  await fastify.register(aiDirectCapabilitiesRoutes);
  // P1 Runtime — Job queue + worker heartbeat (Agent G)
  await fastify.register(aiDirectJobsRoutes);
  await fastify.register(aiDirectWorkersRoutes);
}
