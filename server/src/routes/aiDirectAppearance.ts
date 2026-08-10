import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { requireAuth } from "../middleware/aiDirectAuth.js";
import {
  appearanceEtag,
  assertAppearanceRevision,
  canWriteAppearance,
  loadAgentAppearanceScope,
  parseAppearanceIfMatch,
  requireAppearanceWriteAccess,
  type AgentAppearanceScope,
} from "../services/agentAppearanceAccess.js";
import { AiDirectHiringError, ErrorCodes } from "../services/aiDirectErrors.js";
import {
  managedAssetDownloadHeaders,
  type ManagedAssetStore,
  type StoredManagedAsset,
} from "../services/managedAssetStore.js";
import type { ManagedAssetKind } from "../services/managedAssetValidation.js";

interface AppearanceAsset {
  id: string;
  agentId: string;
  kind: "avatar" | "image_2d" | "model_3d";
  sortOrder: number;
  storageKey: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: string | number | bigint;
  sha256: string;
  createdAt: Date;
}

type AppearanceAssetRow = RowDataPacket & AppearanceAsset;
type AppearanceKind = AppearanceAsset["kind"];

export function createAiDirectAppearanceRoutes(assetStore: ManagedAssetStore) {
  return async function aiDirectAppearanceRoutes(fastify: FastifyInstance): Promise<void> {
    fastify.get("/agents/:agentId/appearance", async (request, reply) => {
      const user = await requireAuth(fastify, request);
      const { agentId } = request.params as { agentId: string };
      const scope = await loadAgentAppearanceScope(fastify.mysql, agentId);
      const access = await canWriteAppearance(fastify.mysql, scope, user.id);
      const assets = await loadAssets(fastify, agentId);
      reply.header("ETag", appearanceEtag(scope.revision));
      return reply.status(200).send(appearanceResponse(scope, assets, access));
    });

    fastify.patch("/agents/:agentId/appearance", async (request, reply) => {
      const user = await requireAuth(fastify, request);
      const { agentId } = request.params as { agentId: string };
      const expectedRevision = parseAppearanceIfMatch(request.headers["if-match"]);
      const patch = parseAppearancePatch(request.body);
      const connection = await fastify.mysql.getConnection();
      try {
        await connection.beginTransaction();
        const scope = await loadAgentAppearanceScope(connection, agentId, true);
        await requireAppearanceWriteAccess(connection, scope, user.id);
        assertAppearanceRevision(expectedRevision, scope.revision);
        if (patch.avatarAssetId) {
          await requireActiveAsset(connection, agentId, patch.avatarAssetId, "avatar");
        }
        const nextRevision = BigInt(scope.revision ?? 0) + 1n;
        await upsertProfile(connection, scope, user.id, nextRevision, patch);
        for (const action of appearanceUpdateActions(patch)) {
          await writeAppearanceAudit(connection, {
            actorUserId: user.id,
            action,
            agentId,
            requestId: requestIdFrom(request),
            metadata: patch,
          });
        }
        await connection.commit();
        reply.header("ETag", appearanceEtag(nextRevision));
        return reply.status(200).send({ revision: nextRevision.toString() });
      } catch (error) {
        await connection.rollback().catch(() => undefined);
        throw error;
      } finally {
        connection.release();
      }
    });

    fastify.post("/agents/:agentId/appearance/assets", async (request, reply) => {
      const user = await requireAuth(fastify, request);
      const { agentId } = request.params as { agentId: string };
      const expectedRevision = parseAppearanceIfMatch(request.headers["if-match"]);
      const initialScope = await loadAgentAppearanceScope(fastify.mysql, agentId);
      await requireAppearanceWriteAccess(fastify.mysql, initialScope, user.id);
      const part = await request.file();
      if (!part) {
        throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "必须上传一个形象文件");
      }
      const kind = parseMultipartKind(part.fields.kind);
      const stored = await assetStore.store({
        kind,
        originalFileName: part.filename,
        declaredMimeType: part.mimetype,
        stream: part.file,
      });
      const assetId = randomUUID();
      const connection = await fastify.mysql.getConnection();
      try {
        await connection.beginTransaction();
        const scope = await loadAgentAppearanceScope(connection, agentId, true);
        await requireAppearanceWriteAccess(connection, scope, user.id);
        assertAppearanceRevision(expectedRevision, scope.revision);
        const sortOrder = await nextAssetOrder(connection, agentId, kind);
        const nextRevision = BigInt(scope.revision ?? 0) + 1n;
        await connection.query(
          `INSERT INTO ai_direct_agent_appearance_assets
             (id, agentId, kind, sortOrder, status, storageKey, originalFileName,
              mimeType, sizeBytes, sha256, createdByUserId, createdAt)
           VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, NOW(3))`,
          [
            assetId,
            agentId,
            kind,
            sortOrder,
            stored.storageKey,
            stored.originalFileName,
            stored.mimeType,
            stored.sizeBytes,
            stored.sha256,
            user.id,
          ],
        );
        await upsertProfile(connection, scope, user.id, nextRevision, {
          ...(kind === "avatar" ? { avatarAssetId: assetId } : {}),
        });
        await writeAppearanceAudit(connection, {
          actorUserId: user.id,
          action: "agent_appearance.asset.added.v1",
          agentId,
          requestId: requestIdFrom(request),
          metadata: { assetId, kind, sha256: stored.sha256 },
        });
        await connection.commit();
        reply.header("ETag", appearanceEtag(nextRevision));
        return reply.status(201).send(
          assetResponse({
            id: assetId,
            agentId,
            kind,
            sortOrder,
            storageKey: stored.storageKey,
            originalFileName: stored.originalFileName,
            mimeType: stored.mimeType,
            sizeBytes: stored.sizeBytes,
            sha256: stored.sha256,
            createdAt: new Date(),
          }),
        );
      } catch (error) {
        await connection.rollback().catch(() => undefined);
        await discardStoredAsset(assetStore, stored);
        throw error;
      } finally {
        connection.release();
      }
    });

    fastify.post("/agents/:agentId/appearance/assets/reorder", async (request, reply) => {
      const user = await requireAuth(fastify, request);
      const { agentId } = request.params as { agentId: string };
      const expectedRevision = parseAppearanceIfMatch(request.headers["if-match"]);
      const { kind, assetIds } = parseReorder(request.body);
      const connection = await fastify.mysql.getConnection();
      try {
        await connection.beginTransaction();
        const scope = await loadAgentAppearanceScope(connection, agentId, true);
        await requireAppearanceWriteAccess(connection, scope, user.id);
        assertAppearanceRevision(expectedRevision, scope.revision);
        const [rows] = await connection.query<AppearanceAssetRow[]>(
          `SELECT id FROM ai_direct_agent_appearance_assets
           WHERE agentId = ? AND kind = ? AND status = 'active'
           ORDER BY sortOrder ASC, createdAt ASC FOR UPDATE`,
          [agentId, kind],
        );
        assertCompleteOrder(
          rows.map((row) => row.id),
          assetIds,
        );
        for (const [sortOrder, id] of assetIds.entries()) {
          await connection.query(
            "UPDATE ai_direct_agent_appearance_assets SET sortOrder = ? WHERE id = ? AND agentId = ?",
            [sortOrder, id, agentId],
          );
        }
        const nextRevision = BigInt(scope.revision ?? 0) + 1n;
        await upsertProfile(connection, scope, user.id, nextRevision, {});
        await writeAppearanceAudit(connection, {
          actorUserId: user.id,
          action: "agent_appearance.assets.reordered.v1",
          agentId,
          requestId: requestIdFrom(request),
          metadata: { kind, assetIds },
        });
        await connection.commit();
        reply.header("ETag", appearanceEtag(nextRevision));
        return reply.status(200).send({ kind, assetIds, revision: nextRevision.toString() });
      } catch (error) {
        await connection.rollback().catch(() => undefined);
        throw error;
      } finally {
        connection.release();
      }
    });

    fastify.delete("/agents/:agentId/appearance/assets/:assetId", async (request, reply) => {
      const user = await requireAuth(fastify, request);
      const { agentId, assetId } = request.params as { agentId: string; assetId: string };
      const expectedRevision = parseAppearanceIfMatch(request.headers["if-match"]);
      const connection = await fastify.mysql.getConnection();
      let storageKey: string | undefined;
      try {
        await connection.beginTransaction();
        const scope = await loadAgentAppearanceScope(connection, agentId, true);
        await requireAppearanceWriteAccess(connection, scope, user.id);
        assertAppearanceRevision(expectedRevision, scope.revision);
        const asset = await requireActiveAsset(connection, agentId, assetId);
        if (scope.avatarAssetId === assetId) {
          throw new AiDirectHiringError(ErrorCodes.ASSET_IN_USE, "头像仍被形象配置引用", 409);
        }
        await connection.query(
          `UPDATE ai_direct_agent_appearance_assets
           SET status = 'deleted', deletedByUserId = ?, deletedAt = NOW(3)
           WHERE id = ? AND agentId = ?`,
          [user.id, assetId, agentId],
        );
        const nextRevision = BigInt(scope.revision ?? 0) + 1n;
        await upsertProfile(connection, scope, user.id, nextRevision, {});
        await writeAppearanceAudit(connection, {
          actorUserId: user.id,
          action: "agent_appearance.asset.removed.v1",
          agentId,
          requestId: requestIdFrom(request),
          metadata: { assetId, kind: asset.kind },
        });
        await connection.commit();
        storageKey = asset.storageKey;
        reply.header("ETag", appearanceEtag(nextRevision));
      } catch (error) {
        await connection.rollback().catch(() => undefined);
        throw error;
      } finally {
        connection.release();
      }
      if (storageKey) {
        try {
          const trashName = await assetStore.moveToTrash(storageKey);
          assetStore.scheduleTrashCleanup(trashName);
        } catch (error) {
          request.log.error({ error, assetId }, "Failed to move deleted appearance asset to trash");
        }
      }
      return reply.status(204).send();
    });

    fastify.get("/appearance-assets/:assetId/content", async (request, reply) => {
      await requireAuth(fastify, request);
      const { assetId } = request.params as { assetId: string };
      const [rows] = await fastify.mysql.query<AppearanceAssetRow[]>(
        `SELECT * FROM ai_direct_agent_appearance_assets
         WHERE id = ? AND status = 'active' AND deletedAt IS NULL LIMIT 1`,
        [assetId],
      );
      const asset = rows[0];
      if (!asset) {
        throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "形象资源不存在", 404);
      }
      const opened = await assetStore.open(asset.storageKey);
      reply.headers(
        managedAssetDownloadHeaders({ mimeType: asset.mimeType, sha256: asset.sha256 }),
      );
      reply.header("Content-Length", String(opened.sizeBytes));
      return reply.send(opened.stream);
    });
  };
}

async function loadAssets(
  fastify: FastifyInstance,
  agentId: string,
): Promise<AppearanceAssetRow[]> {
  const [rows] = await fastify.mysql.query<AppearanceAssetRow[]>(
    `SELECT * FROM ai_direct_agent_appearance_assets
     WHERE agentId = ? AND status = 'active' AND deletedAt IS NULL
     ORDER BY kind ASC, sortOrder ASC, createdAt ASC`,
    [agentId],
  );
  return rows;
}

function appearanceResponse(
  scope: AgentAppearanceScope,
  assets: AppearanceAssetRow[],
  access: { canWrite: boolean; authority: string | null; readOnlyReason: string | null },
) {
  const byKind = (kind: AppearanceKind) =>
    assets.filter((asset) => asset.kind === kind).map(assetResponse);
  return {
    agentId: scope.agentId,
    avatarAssetId: scope.avatarAssetId,
    defaultMode: scope.defaultMode,
    revision: String(scope.revision ?? 0),
    control: {
      controllerEmploymentId: scope.controllerEmploymentId,
      controllerCompanyId: scope.controllerCompanyId,
      canWrite: access.canWrite,
      authority: access.authority,
      readOnlyReason: access.readOnlyReason,
    },
    assets: {
      avatar: byKind("avatar"),
      image2d: byKind("image_2d"),
      model3d: byKind("model_3d"),
    },
    presentation: {
      image2d: { autoRotate: true, manualSwitch: true, maximumAssets: 5 },
      model3d: {
        autoRotate: false,
        manualSwitch: true,
        rotate360: true,
        maximumScale: 3,
        resetView: true,
      },
    },
    updatedAt: scope.updatedAt,
  };
}

function assetResponse(asset: AppearanceAsset) {
  return {
    id: asset.id,
    kind: asset.kind,
    sortOrder: asset.sortOrder,
    mimeType: asset.mimeType,
    sizeBytes: String(asset.sizeBytes),
    sha256: asset.sha256,
    contentUrl: `/api/v1/ai-direct-hiring/appearance-assets/${asset.id}/content`,
    createdAt: asset.createdAt,
  };
}

async function nextAssetOrder(
  connection: PoolConnection,
  agentId: string,
  kind: AppearanceKind,
): Promise<number> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT id, sortOrder FROM ai_direct_agent_appearance_assets
     WHERE agentId = ? AND kind = ? AND status = 'active'
     ORDER BY sortOrder DESC FOR UPDATE`,
    [agentId, kind],
  );
  if (kind === "image_2d" && rows.length >= 5) {
    throw new AiDirectHiringError(
      ErrorCodes.ASSET_LIMIT_EXCEEDED,
      "每个 Agent 最多允许 5 张 2D 形象",
      409,
      { kind, maximum: 5 },
    );
  }
  return kind === "avatar" ? 0 : Number(rows[0]?.sortOrder ?? -1) + 1;
}

async function requireActiveAsset(
  connection: PoolConnection,
  agentId: string,
  assetId: string,
  kind?: AppearanceKind,
): Promise<AppearanceAssetRow> {
  const [rows] = await connection.query<AppearanceAssetRow[]>(
    `SELECT * FROM ai_direct_agent_appearance_assets
     WHERE id = ? AND agentId = ? AND status = 'active' AND deletedAt IS NULL
     LIMIT 1 FOR UPDATE`,
    [assetId, agentId],
  );
  const asset = rows[0];
  if (!asset || (kind && asset.kind !== kind)) {
    throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "形象资源不存在或类型不匹配", 404);
  }
  return asset;
}

async function upsertProfile(
  connection: PoolConnection,
  scope: AgentAppearanceScope,
  userId: string,
  revision: bigint,
  patch: { defaultMode?: "image_2d" | "model_3d"; avatarAssetId?: string | null },
): Promise<void> {
  const avatarAssetId =
    patch.avatarAssetId === undefined ? scope.avatarAssetId : patch.avatarAssetId;
  const defaultMode = patch.defaultMode ?? scope.defaultMode;
  await connection.query(
    `INSERT INTO ai_direct_agent_appearance_profiles
       (agentId, avatarAssetId, defaultMode, controllerEmploymentId, controllerCompanyId,
        revision, updatedByUserId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))
     ON DUPLICATE KEY UPDATE
       avatarAssetId = VALUES(avatarAssetId), defaultMode = VALUES(defaultMode),
       revision = VALUES(revision), updatedByUserId = VALUES(updatedByUserId), updatedAt = NOW(3)`,
    [
      scope.agentId,
      avatarAssetId,
      defaultMode,
      scope.controllerEmploymentId,
      scope.controllerCompanyId,
      revision.toString(),
      userId,
    ],
  );
}

async function writeAppearanceAudit(
  connection: PoolConnection,
  input: {
    actorUserId: string;
    action: string;
    agentId: string;
    requestId: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  await connection.query(
    `INSERT INTO ai_direct_audit_events
       (id, organizationId, actorUserId, action, targetType, targetId, requestId, outcome, metadata)
     VALUES (?, NULL, ?, ?, 'agent_appearance', ?, ?, 'success', CAST(? AS JSON))`,
    [
      randomUUID(),
      input.actorUserId,
      input.action,
      input.agentId,
      input.requestId,
      JSON.stringify(input.metadata),
    ],
  );
}

function appearanceUpdateActions(patch: {
  defaultMode?: "image_2d" | "model_3d";
  avatarAssetId?: string | null;
}): string[] {
  return [
    ...(Object.hasOwn(patch, "avatarAssetId") ? ["agent_appearance.avatar.updated.v1"] : []),
    ...(Object.hasOwn(patch, "defaultMode") ? ["agent_appearance.default_mode.updated.v1"] : []),
  ];
}

function parseAppearancePatch(value: unknown): {
  defaultMode?: "image_2d" | "model_3d";
  avatarAssetId?: string | null;
} {
  const body = requireObject(value, ["defaultMode", "avatarAssetId"]);
  if (Object.keys(body).length === 0) invalid("至少提供一个形象配置字段");
  const result: { defaultMode?: "image_2d" | "model_3d"; avatarAssetId?: string | null } = {};
  if (body.defaultMode !== undefined) {
    if (body.defaultMode !== "image_2d" && body.defaultMode !== "model_3d")
      invalid("defaultMode 无效");
    result.defaultMode = body.defaultMode;
  }
  if (body.avatarAssetId !== undefined) {
    if (body.avatarAssetId !== null && !isUuid(body.avatarAssetId))
      invalid("avatarAssetId 必须是 UUID 或 null");
    result.avatarAssetId = body.avatarAssetId as string | null;
  }
  return result;
}

function parseReorder(value: unknown): { kind: "image_2d" | "model_3d"; assetIds: string[] } {
  const body = requireObject(value, ["kind", "assetIds"]);
  if (body.kind !== "image_2d" && body.kind !== "model_3d")
    invalid("仅支持重排 image_2d 或 model_3d");
  if (!Array.isArray(body.assetIds) || body.assetIds.some((id) => !isUuid(id)))
    invalid("assetIds 必须是 UUID 数组");
  const assetIds = body.assetIds as string[];
  if (new Set(assetIds).size !== assetIds.length) invalid("assetIds 不能重复");
  return { kind: body.kind, assetIds };
}

function parseMultipartKind(field: unknown): ManagedAssetKind & AppearanceKind {
  const value =
    field && typeof field === "object" && "value" in field
      ? (field as { value: unknown }).value
      : undefined;
  if (value !== "avatar" && value !== "image_2d" && value !== "model_3d") {
    invalid("multipart kind 必须是 avatar、image_2d 或 model_3d");
  }
  return value;
}

function assertCompleteOrder(current: string[], requested: string[]): void {
  if (current.length !== requested.length || current.some((id) => !requested.includes(id))) {
    throw new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      "assetIds 必须完整包含该类型的全部有效资源",
      400,
      { currentAssetIds: current },
    );
  }
}

function requireObject(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("请求体必须是对象");
  const body = value as Record<string, unknown>;
  const extras = Object.keys(body).filter((key) => !allowed.includes(key));
  if (extras.length > 0) invalid(`不接受字段: ${extras.join(", ")}`);
  return body;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function invalid(message: string): never {
  throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, message);
}

function requestIdFrom(request: FastifyRequest): string {
  const value = request.headers["x-request-id"];
  return typeof value === "string" && value.length > 0 && value.length <= 128
    ? value
    : randomUUID();
}

async function discardStoredAsset(
  assetStore: ManagedAssetStore,
  stored: StoredManagedAsset,
): Promise<void> {
  try {
    const trashName = await assetStore.moveToTrash(stored.storageKey);
    await assetStore.deleteFromTrash(trashName);
  } catch {
    // Orphaned managed files are not addressable without database metadata and can be swept later.
  }
}
