import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/aiDirectAuth.js";
import { AiDirectHiringError, ErrorCodes, errorResponse } from "../services/aiDirectErrors.js";
import { buildCandidateCatalogDigest } from "../services/candidateCatalogDigest.js";
import {
  extractRequestId,
  idempotencyFingerprint,
  parseIdempotencyKey,
} from "../utils/idempotency.js";
import { publishOutboxEvent } from "../utils/outbox.js";

type Database = {
  query(sql: string, values?: unknown[]): Promise<[unknown]>;
  getConnection(): Promise<
    Database & {
      beginTransaction(): Promise<void>;
      commit(): Promise<void>;
      rollback(): Promise<void>;
      release(): void;
    }
  >;
};

type AgentRow = {
  id: string;
  ownerUserId: string;
  ownerPublisherId: string | null;
  name: string;
  description: string | null;
  status: string;
  activeVersionId: string | null;
  catalogVisibility: string;
  availability: string;
  categoryKey: string | null;
  catalogSummary: string | null;
  capabilitySummary: unknown;
  appearanceAssetId: string | null;
  priceStatus: string;
};

type VersionRow = {
  id: string;
  agentId: string;
  version: number;
  status: string;
  reviewStatus: string;
  securityStatus: string;
  modelPolicy: unknown;
};

const readBody = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "请求体必须是对象");
  }
  return value as Record<string, unknown>;
};

const readString = (value: unknown, field: string, maxLength: number): string => {
  if (typeof value !== "string") {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 必须是字符串`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      `${field} 长度必须为 1 到 ${maxLength}`,
    );
  }
  return normalized;
};

const requireObject = (value: unknown, field: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 必须是对象`);
  }
  return value as Record<string, unknown>;
};

const rejectExtra = (body: Record<string, unknown>, fields: string[], endpoint: string): void => {
  const extra = Object.keys(body).filter((key) => !fields.includes(key));
  if (extra.length) {
    throw new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      `${endpoint} 不接受以下字段: ${extra.join(", ")}`,
      400,
      { extraFields: extra },
    );
  }
};

const rows = <T>(value: unknown): T[] => value as T[];

const catalogCapabilities = (value: unknown): unknown => {
  if (typeof value !== "string") return value ?? [];
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return [];
  }
};

async function assertAgentAccess(
  pool: Database,
  agentId: string,
  userId: string,
): Promise<AgentRow> {
  const [result] = await pool.query(
    `SELECT DISTINCT a.id, a.ownerUserId, a.ownerPublisherId, a.name, a.description, a.status, a.activeVersionId,
            a.catalogVisibility, a.availability, a.categoryKey, a.catalogSummary, a.capabilitySummary,
            a.appearanceAssetId, a.priceStatus
     FROM ai_direct_agents a
     LEFT JOIN publisherMembers pm ON pm.publisherId = a.ownerPublisherId AND pm.userId = ?
     WHERE a.id = ? AND (a.ownerUserId = ? OR pm.userId IS NOT NULL)
     LIMIT 1`,
    [userId, agentId, userId],
  );
  const agent = rows<AgentRow>(result)[0];
  if (!agent) {
    throw new AiDirectHiringError(
      ErrorCodes.FORBIDDEN_SCOPE,
      "未找到 Agent，或当前用户没有访问权限",
      403,
    );
  }
  return agent;
}

async function writeAudit(
  connection: Database,
  input: {
    actorUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    requestId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await connection.query(
    `INSERT INTO ai_direct_audit_events
     (id, organizationId, actorUserId, action, targetType, targetId, requestId, outcome, metadata)
     VALUES (?, NULL, ?, ?, ?, ?, ?, 'success', ?)`,
    [
      randomUUID(),
      input.actorUserId,
      input.action,
      input.targetType,
      input.targetId,
      input.requestId,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );
}

export async function aiDirectAgentPublicationRoutes(fastify: FastifyInstance): Promise<void> {
  const pool = (fastify as unknown as { mysql: Database }).mysql;

  fastify.get("/agents", { onRequest: [fastify.authenticate] }, async (request) => {
    const user = await requireAuth(fastify, request);
    const [result] = await pool.query(
      `SELECT DISTINCT a.id, a.name, a.description, a.status, a.activeVersionId, a.createdAt, a.updatedAt,
              v.version AS activeVersion, v.reviewStatus, v.securityStatus
       FROM ai_direct_agents a
       LEFT JOIN publisherMembers pm ON pm.publisherId = a.ownerPublisherId AND pm.userId = ?
       LEFT JOIN ai_direct_agent_versions v ON v.id = a.activeVersionId
       WHERE a.ownerUserId = ? OR pm.userId IS NOT NULL
       ORDER BY a.updatedAt DESC, a.id DESC LIMIT 100`,
      [user.id, user.id],
    );
    return { items: result };
  });

  fastify.get(
    "/agents/:agentId/versions",
    { onRequest: [fastify.authenticate] },
    async (request) => {
      const user = await requireAuth(fastify, request);
      const { agentId } = request.params as { agentId: string };
      await assertAgentAccess(pool, agentId, user.id);
      const [result] = await pool.query(
        `SELECT id, version, status, reviewStatus, securityStatus, createdByUserId, reviewedByUserId, reviewedAt, publishedAt, createdAt
       FROM ai_direct_agent_versions WHERE agentId = ? ORDER BY version DESC LIMIT 100`,
        [agentId],
      );
      return { items: result };
    },
  );

  fastify.post("/agents", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    try {
      const user = await requireAuth(fastify, request);
      const body = readBody(request.body);
      rejectExtra(
        body,
        ["name", "description", "publisherId", "promptSpec", "modelPolicy"],
        "POST /agents",
      );
      const name = readString(body.name, "name", 120);
      const description =
        body.description === undefined ? null : readString(body.description, "description", 2000);
      const publisherId =
        body.publisherId === undefined ? null : readString(body.publisherId, "publisherId", 191);
      const promptSpec = requireObject(body.promptSpec, "promptSpec");
      const modelPolicy = requireObject(body.modelPolicy, "modelPolicy");
      if (publisherId) {
        const [membership] = await pool.query(
          "SELECT 1 FROM publisherMembers WHERE publisherId = ? AND userId = ? LIMIT 1",
          [publisherId, user.id],
        );
        if (!rows(membership).length)
          throw new AiDirectHiringError(
            ErrorCodes.FORBIDDEN_SCOPE,
            "当前用户不是该 Publisher 成员",
            403,
          );
      }

      const key = parseIdempotencyKey(request);
      const fingerprint = idempotencyFingerprint({
        name,
        description,
        publisherId,
        promptSpec,
        modelPolicy,
      });
      const agentId = randomUUID();
      const versionId = randomUUID();
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        if (key) {
          const [existingResult] = await connection.query(
            "SELECT id, idempotencyFingerprint FROM ai_direct_agents WHERE ownerUserId = ? AND idempotencyKey = ? LIMIT 1 FOR UPDATE",
            [user.id, key],
          );
          const existing = rows<{ id: string; idempotencyFingerprint: string | null }>(
            existingResult,
          )[0];
          if (existing) {
            if (existing.idempotencyFingerprint !== fingerprint)
              throw new AiDirectHiringError(
                ErrorCodes.IDEMPOTENCY_KEY_REUSED,
                "幂等键已用于不同的创建请求",
                409,
              );
            await connection.rollback();
            return reply.status(200).send({ id: existing.id, replayed: true });
          }
        }
        await connection.query(
          `INSERT INTO ai_direct_agents
           (id, ownerUserId, ownerPublisherId, name, description, status, activeVersionId, idempotencyKey, idempotencyFingerprint)
           VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
          [
            agentId,
            user.id,
            publisherId,
            name,
            description,
            versionId,
            key,
            key ? fingerprint : null,
          ],
        );
        await connection.query(
          `INSERT INTO ai_direct_agent_versions
           (id, agentId, version, status, reviewStatus, securityStatus, promptSpec, modelPolicy, executionPolicy, createdByUserId)
           VALUES (?, ?, 1, 'draft', 'draft', 'pending', ?, ?, JSON_OBJECT(), ?)`,
          [versionId, agentId, JSON.stringify(promptSpec), JSON.stringify(modelPolicy), user.id],
        );
        const requestId = extractRequestId(request);
        await writeAudit(connection, {
          actorUserId: user.id,
          action: "agent.created",
          targetType: "agent",
          targetId: agentId,
          requestId,
          metadata: { versionId },
        });
        await publishOutboxEvent(connection, {
          organizationId: null,
          aggregateType: "agent",
          aggregateId: agentId,
          eventType: "agent.created.v1",
          payload: { agentId, versionId },
        });
        await connection.commit();
        return reply.status(201).send({ id: agentId, activeVersionId: versionId, status: "draft" });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      if (error instanceof AiDirectHiringError)
        return reply.status(error.httpStatus).send(errorResponse(error));
      throw error;
    }
  });

  fastify.post(
    "/agents/:agentId/versions",
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const user = await requireAuth(fastify, request);
        const { agentId } = request.params as { agentId: string };
        await assertAgentAccess(pool, agentId, user.id);
        const body = readBody(request.body);
        rejectExtra(
          body,
          ["promptSpec", "modelPolicy", "executionPolicy"],
          "POST /agents/:agentId/versions",
        );
        const promptSpec = requireObject(body.promptSpec, "promptSpec");
        const executionPolicy =
          body.executionPolicy === undefined
            ? {}
            : requireObject(body.executionPolicy, "executionPolicy");
        const modelPolicy = requireObject(body.modelPolicy, "modelPolicy");
        const key = parseIdempotencyKey(request);
        const fingerprint = idempotencyFingerprint({ promptSpec, modelPolicy, executionPolicy });
        const versionId = randomUUID();
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          if (key) {
            const [existingResult] = await connection.query(
              "SELECT id, version, idempotencyFingerprint FROM ai_direct_agent_versions WHERE agentId = ? AND idempotencyKey = ? LIMIT 1 FOR UPDATE",
              [agentId, key],
            );
            const existing = rows<{
              id: string;
              version: number;
              idempotencyFingerprint: string | null;
            }>(existingResult)[0];
            if (existing) {
              if (existing.idempotencyFingerprint !== fingerprint)
                throw new AiDirectHiringError(
                  ErrorCodes.IDEMPOTENCY_KEY_REUSED,
                  "幂等键已用于不同的创建请求",
                  409,
                );
              await connection.rollback();
              return reply
                .status(200)
                .send({ id: existing.id, agentId, version: existing.version, replayed: true });
            }
          }
          const [latestResult] = await connection.query(
            "SELECT COALESCE(MAX(version), 0) AS version FROM ai_direct_agent_versions WHERE agentId = ? FOR UPDATE",
            [agentId],
          );
          const version = Number(rows<{ version: number }>(latestResult)[0]?.version ?? 0) + 1;
          await connection.query(
            `INSERT INTO ai_direct_agent_versions
           (id, agentId, version, status, reviewStatus, securityStatus, promptSpec, modelPolicy, executionPolicy, createdByUserId, idempotencyKey, idempotencyFingerprint)
           VALUES (?, ?, ?, 'draft', 'draft', 'pending', ?, ?, ?, ?, ?, ?)`,
            [
              versionId,
              agentId,
              version,
              JSON.stringify(promptSpec),
              JSON.stringify(modelPolicy),
              JSON.stringify(executionPolicy),
              user.id,
              key,
              key ? fingerprint : null,
            ],
          );
          const requestId = extractRequestId(request);
          await writeAudit(connection, {
            actorUserId: user.id,
            action: "agent_version.created",
            targetType: "agent_version",
            targetId: versionId,
            requestId,
            metadata: { agentId, version },
          });
          await publishOutboxEvent(connection, {
            organizationId: null,
            aggregateType: "agent_version",
            aggregateId: versionId,
            eventType: "agent_version.created.v1",
            payload: { agentId, versionId, version },
          });
          await connection.commit();
          return reply.status(201).send({ id: versionId, agentId, version, status: "draft" });
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      } catch (error) {
        if (error instanceof AiDirectHiringError)
          return reply.status(error.httpStatus).send(errorResponse(error));
        throw error;
      }
    },
  );

  fastify.put(
    "/agents/:agentId/catalog-settings",
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const user = await requireAuth(fastify, request);
        const { agentId } = request.params as { agentId: string };
        await assertAgentAccess(pool, agentId, user.id);
        const body = readBody(request.body);
        rejectExtra(
          body,
          [
            "catalogVisibility",
            "availability",
            "categoryKey",
            "summary",
            "capabilities",
            "appearanceAssetId",
            "priceStatus",
          ],
          "PUT /agents/:agentId/catalog-settings",
        );
        const catalogVisibility = body.catalogVisibility;
        const availability = body.availability;
        const priceStatus = body.priceStatus;
        if (catalogVisibility !== "private" && catalogVisibility !== "org_authenticated") {
          throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "catalogVisibility 无效");
        }
        if (availability !== "available" && availability !== "unavailable") {
          throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "availability 无效");
        }
        if (priceStatus !== "internal_use") {
          throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "priceStatus 无效");
        }
        const categoryKey =
          body.categoryKey === null ? null : readString(body.categoryKey, "categoryKey", 80);
        const summary = body.summary === null ? null : readString(body.summary, "summary", 500);
        const appearanceAssetId =
          body.appearanceAssetId === null
            ? null
            : readString(body.appearanceAssetId, "appearanceAssetId", 36);
        if (
          !Array.isArray(body.capabilities) ||
          body.capabilities.length > 20 ||
          body.capabilities.some(
            (value) => typeof value !== "string" || !value.trim() || value.length > 120,
          )
        ) {
          throw new AiDirectHiringError(
            ErrorCodes.VALIDATION_ERROR,
            "capabilities 必须是至多 20 项的非空字符串数组",
          );
        }
        const capabilities = body.capabilities.map((value) => (value as string).trim());
        await pool.query(
          `UPDATE ai_direct_agents
         SET catalogVisibility = ?, availability = ?, categoryKey = ?, catalogSummary = ?, capabilitySummary = ?, appearanceAssetId = ?, priceStatus = ?
         WHERE id = ?`,
          [
            catalogVisibility,
            availability,
            categoryKey,
            summary,
            JSON.stringify(capabilities),
            appearanceAssetId,
            priceStatus,
            agentId,
          ],
        );
        return {
          agentId,
          catalogVisibility,
          availability,
          categoryKey,
          summary,
          capabilities,
          appearanceAssetId,
          priceStatus,
        };
      } catch (error) {
        if (error instanceof AiDirectHiringError)
          return reply.status(error.httpStatus).send(errorResponse(error));
        throw error;
      }
    },
  );

  fastify.post(
    "/agent-versions/:versionId/review",
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const user = await requireAuth(fastify, request);
        if (user.role !== "admin")
          throw new AiDirectHiringError(
            ErrorCodes.FORBIDDEN_SCOPE,
            "只有平台管理员可以裁决审核",
            403,
          );
        const { versionId } = request.params as { versionId: string };
        const body = readBody(request.body);
        rejectExtra(body, ["decision", "securityStatus"], "POST /agent-versions/:versionId/review");
        const decision = body.decision;
        const securityStatus = body.securityStatus === undefined ? "approved" : body.securityStatus;
        if (
          (decision !== "approved" && decision !== "rejected") ||
          (securityStatus !== "approved" && securityStatus !== "rejected")
        ) {
          throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "审核结果无效");
        }
        const [result] = await pool.query(
          "SELECT id, status FROM ai_direct_agent_versions WHERE id = ? LIMIT 1",
          [versionId],
        );
        const version = rows<{ id: string; status: string }>(result)[0];
        if (!version) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "Agent 版本不存在", 404);
        if (version.status !== "submitted")
          throw new AiDirectHiringError(
            ErrorCodes.INVALID_TRANSITION,
            "只有已提交版本可以裁决",
            409,
          );
        const status =
          decision === "approved" && securityStatus === "approved" ? "approved" : "rejected";
        await pool.query(
          "UPDATE ai_direct_agent_versions SET status = ?, reviewStatus = ?, securityStatus = ?, reviewedByUserId = ?, reviewedAt = NOW() WHERE id = ?",
          [status, decision, securityStatus, user.id, versionId],
        );
        return { id: versionId, status };
      } catch (error) {
        if (error instanceof AiDirectHiringError)
          return reply.status(error.httpStatus).send(errorResponse(error));
        throw error;
      }
    },
  );

  fastify.post(
    "/agent-versions/:versionId/publish",
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const user = await requireAuth(fastify, request);
        const { versionId } = request.params as { versionId: string };
        const [result] = await pool.query(
          "SELECT id, agentId, status, reviewStatus, securityStatus FROM ai_direct_agent_versions WHERE id = ? LIMIT 1",
          [versionId],
        );
        const version = rows<VersionRow>(result)[0];
        if (!version) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "Agent 版本不存在", 404);
        const agent = await assertAgentAccess(pool, version.agentId, user.id);
        if (version.status === "published")
          return { id: versionId, status: "published", replayed: true };
        if (
          version.status !== "approved" ||
          version.reviewStatus !== "approved" ||
          version.securityStatus !== "approved"
        ) {
          throw new AiDirectHiringError(
            ErrorCodes.APPROVAL_REQUIRED,
            "发布需要已批准的审核与安全裁决",
            409,
          );
        }
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          await connection.query(
            "UPDATE ai_direct_agent_versions SET status = 'published', publishedAt = NOW() WHERE id = ? AND status = 'approved'",
            [versionId],
          );
          await connection.query(
            "UPDATE ai_direct_agents SET activeVersionId = ?, status = 'active' WHERE id = ?",
            [versionId, version.agentId],
          );
          if (
            agent.catalogVisibility === "org_authenticated" &&
            agent.availability === "available"
          ) {
            const digest = buildCandidateCatalogDigest({
              agentId: agent.id,
              agentVersionId: versionId,
              displayName: agent.name,
              summary: agent.catalogSummary ?? agent.description,
              categoryKey: agent.categoryKey,
              capabilitySummary: catalogCapabilities(agent.capabilitySummary),
              appearanceAssetId: agent.appearanceAssetId,
              availability: agent.availability,
              priceStatus: agent.priceStatus,
            });
            const [currentResult] = await connection.query(
              "SELECT sourceRevision FROM ai_direct_candidate_catalog_digests WHERE agentId = ? FOR UPDATE",
              [agent.id],
            );
            if (
              rows<{ sourceRevision: string }>(currentResult)[0]?.sourceRevision !==
              digest.sourceRevision
            ) {
              await connection.query(
                `INSERT INTO ai_direct_candidate_catalog_digests
               (agentId, agentVersionId, displayName, summary, categoryKey, capabilitySummary, appearanceAssetId, availability, priceStatus, searchText, sourceRevision)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE agentVersionId = VALUES(agentVersionId), displayName = VALUES(displayName), summary = VALUES(summary),
                 categoryKey = VALUES(categoryKey), capabilitySummary = VALUES(capabilitySummary), appearanceAssetId = VALUES(appearanceAssetId),
                 availability = VALUES(availability), priceStatus = VALUES(priceStatus), searchText = VALUES(searchText), sourceRevision = VALUES(sourceRevision)`,
                [
                  digest.agentId,
                  digest.agentVersionId,
                  digest.displayName,
                  digest.summary,
                  digest.categoryKey,
                  JSON.stringify(digest.capabilitySummary),
                  digest.appearanceAssetId,
                  digest.availability,
                  digest.priceStatus,
                  digest.searchText,
                  digest.sourceRevision,
                ],
              );
            }
          } else {
            await connection.query(
              "DELETE FROM ai_direct_candidate_catalog_digests WHERE agentId = ?",
              [agent.id],
            );
          }
          const requestId = extractRequestId(request);
          await writeAudit(connection, {
            actorUserId: user.id,
            action: "agent_version.published",
            targetType: "agent_version",
            targetId: versionId,
            requestId,
            metadata: { agentId: version.agentId },
          });
          await publishOutboxEvent(connection, {
            organizationId: null,
            aggregateType: "agent_version",
            aggregateId: versionId,
            eventType: "agent_version.published.v1",
            payload: { agentId: version.agentId, versionId },
          });
          await connection.commit();
          return { id: versionId, status: "published" };
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      } catch (error) {
        if (error instanceof AiDirectHiringError)
          return reply.status(error.httpStatus).send(errorResponse(error));
        throw error;
      }
    },
  );

  fastify.post(
    "/agent-versions/:versionId/submit",
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const user = await requireAuth(fastify, request);
        const { versionId } = request.params as { versionId: string };
        const [result] = await pool.query(
          "SELECT id, agentId, status FROM ai_direct_agent_versions WHERE id = ? LIMIT 1",
          [versionId],
        );
        const version = rows<Pick<VersionRow, "id" | "agentId" | "status">>(result)[0];
        if (!version) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "Agent 版本不存在", 404);
        await assertAgentAccess(pool, version.agentId, user.id);
        if (version.status !== "draft")
          throw new AiDirectHiringError(
            ErrorCodes.INVALID_TRANSITION,
            "只有草稿版本可以提交审核",
            409,
          );
        await pool.query(
          "UPDATE ai_direct_agent_versions SET status = 'submitted', reviewStatus = 'submitted' WHERE id = ?",
          [versionId],
        );
        return { id: versionId, status: "submitted" };
      } catch (error) {
        if (error instanceof AiDirectHiringError)
          return reply.status(error.httpStatus).send(errorResponse(error));
        throw error;
      }
    },
  );
}
