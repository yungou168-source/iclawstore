import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { requireAuth } from "../middleware/aiDirectAuth.js";
import { AiDirectHiringError, ErrorCodes } from "../services/aiDirectErrors.js";
import {
  parseDesktopSidebarConfig,
  parseSidebarIfMatch,
  sidebarEtag,
  sidebarIconAssetIds,
  type DesktopSidebarConfig,
} from "../services/desktopSidebarConfig.js";
import {
  managedAssetDownloadHeaders,
  type ManagedAssetStore,
  type StoredManagedAsset,
} from "../services/managedAssetStore.js";

interface SidebarPreferenceRow extends RowDataPacket {
  config: string | DesktopSidebarConfig;
  revision: string | number | bigint;
  updatedAt: Date;
}

interface SidebarAssetRow extends RowDataPacket {
  id: string;
  userId: string;
  storageKey: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: string | number | bigint;
  sha256: string;
  createdAt: Date;
  deletedAt: Date | null;
}

export function createDesktopPreferencesRoutes(assetStore: ManagedAssetStore) {
  return async function desktopPreferencesRoutes(fastify: FastifyInstance): Promise<void> {
    fastify.get("/sidebar", async (request, reply) => {
      const user = await requireAuth(fastify, request);
      const [rows] = await fastify.mysql.query<SidebarPreferenceRow[]>(
        `SELECT config, revision, updatedAt
         FROM desktop_sidebar_preferences
         WHERE userId = ?
         LIMIT 1`,
        [user.id],
      );
      if (!rows[0]) {
        reply.header("ETag", sidebarEtag(0));
        return reply
          .status(200)
          .send({ overridden: false, config: null, revision: "0", updatedAt: null });
      }
      const config = parseStoredConfig(rows[0].config);
      const revision = String(rows[0].revision);
      reply.header("ETag", sidebarEtag(revision));
      return reply.status(200).send({
        overridden: true,
        config,
        revision,
        updatedAt: rows[0].updatedAt,
      });
    });

    fastify.put("/sidebar", async (request, reply) => {
      const user = await requireAuth(fastify, request);
      const expectedRevision = parseSidebarIfMatch(request.headers["if-match"]);
      const config = parseDesktopSidebarConfig(request.body);
      const connection = await fastify.mysql.getConnection();
      try {
        await connection.beginTransaction();
        const current = await lockSidebarPreference(connection, user.id);
        assertExpectedRevision(expectedRevision, current?.revision ?? 0);
        await assertOwnedIcons(connection, user.id, sidebarIconAssetIds(config));
        await assertKnownTemplates(connection, config);
        const nextRevision = BigInt(current?.revision ?? 0) + 1n;
        await connection.query(
          `INSERT INTO desktop_sidebar_preferences
             (userId, config, revision, createdAt, updatedAt)
           VALUES (?, CAST(? AS JSON), ?, NOW(3), NOW(3))
           ON DUPLICATE KEY UPDATE
             config = VALUES(config), revision = VALUES(revision), updatedAt = NOW(3)`,
          [user.id, JSON.stringify(config), nextRevision.toString()],
        );
        await connection.commit();
        reply.header("ETag", sidebarEtag(nextRevision));
        return reply.status(200).send({
          overridden: true,
          config,
          revision: nextRevision.toString(),
        });
      } catch (error) {
        await connection.rollback().catch(() => undefined);
        throw error;
      } finally {
        connection.release();
      }
    });

    fastify.delete("/sidebar", async (request, reply) => {
      const user = await requireAuth(fastify, request);
      const expectedRevision = parseSidebarIfMatch(request.headers["if-match"]);
      const connection = await fastify.mysql.getConnection();
      try {
        await connection.beginTransaction();
        const current = await lockSidebarPreference(connection, user.id);
        assertExpectedRevision(expectedRevision, current?.revision ?? 0);
        if (current) {
          await connection.query("DELETE FROM desktop_sidebar_preferences WHERE userId = ?", [
            user.id,
          ]);
        }
        await connection.commit();
        reply.header("ETag", sidebarEtag(0));
        return reply.status(204).send();
      } catch (error) {
        await connection.rollback().catch(() => undefined);
        throw error;
      } finally {
        connection.release();
      }
    });

    fastify.post("/sidebar/icons", async (request, reply) => {
      const user = await requireAuth(fastify, request);
      const part = await request.file();
      if (!part) {
        throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "必须上传一个 Logo 文件");
      }
      const stored = await assetStore.store({
        kind: "sidebar_icon",
        originalFileName: part.filename,
        declaredMimeType: part.mimetype,
        stream: part.file,
      });
      const id = randomUUID();
      try {
        await fastify.mysql.query(
          `INSERT INTO desktop_sidebar_assets
             (id, userId, storageKey, originalFileName, mimeType, sizeBytes, sha256, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3))`,
          [
            id,
            user.id,
            stored.storageKey,
            stored.originalFileName,
            stored.mimeType,
            stored.sizeBytes,
            stored.sha256,
          ],
        );
      } catch (error) {
        await discardStoredAsset(assetStore, stored);
        throw error;
      }
      return reply.status(201).send({
        id,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        contentUrl: `/api/v1/desktop/sidebar/icons/${id}/content`,
      });
    });

    fastify.get("/sidebar/icons/:id/content", async (request, reply) => {
      const user = await requireAuth(fastify, request);
      const { id } = request.params as { id: string };
      const asset = await findOwnedAsset(fastify, user.id, id);
      const opened = await assetStore.open(asset.storageKey);
      reply.headers(
        managedAssetDownloadHeaders({ mimeType: asset.mimeType, sha256: asset.sha256 }),
      );
      reply.header("Content-Length", String(opened.sizeBytes));
      return reply.send(opened.stream);
    });

    fastify.delete("/sidebar/icons/:id", async (request, reply) => {
      const user = await requireAuth(fastify, request);
      const { id } = request.params as { id: string };
      const connection = await fastify.mysql.getConnection();
      let storageKey: string | undefined;
      try {
        await connection.beginTransaction();
        const [assetRows] = await connection.query<SidebarAssetRow[]>(
          `SELECT * FROM desktop_sidebar_assets
           WHERE id = ? AND userId = ? AND deletedAt IS NULL
           LIMIT 1 FOR UPDATE`,
          [id, user.id],
        );
        const asset = assetRows[0];
        if (!asset) {
          throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "Logo 资源不存在", 404);
        }
        const current = await lockSidebarPreference(connection, user.id);
        if (current && sidebarIconAssetIds(parseStoredConfig(current.config)).includes(id)) {
          throw new AiDirectHiringError(ErrorCodes.ASSET_IN_USE, "Logo 仍被侧栏配置引用", 409);
        }
        await connection.query(
          "UPDATE desktop_sidebar_assets SET deletedAt = NOW(3) WHERE id = ? AND userId = ?",
          [id, user.id],
        );
        await connection.commit();
        storageKey = asset.storageKey;
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
          request.log.error({ error, id }, "Failed to move deleted sidebar asset to trash");
        }
      }
      return reply.status(204).send();
    });
  };
}

async function lockSidebarPreference(
  connection: PoolConnection,
  userId: string,
): Promise<SidebarPreferenceRow | undefined> {
  const [rows] = await connection.query<SidebarPreferenceRow[]>(
    `SELECT config, revision, updatedAt
     FROM desktop_sidebar_preferences
     WHERE userId = ?
     LIMIT 1 FOR UPDATE`,
    [userId],
  );
  return rows[0];
}

function assertExpectedRevision(
  expectedRevision: bigint,
  currentRevision: string | number | bigint,
): void {
  const current = BigInt(currentRevision);
  if (expectedRevision !== current) {
    throw new AiDirectHiringError(ErrorCodes.REVISION_CONFLICT, "侧栏配置已被其他设备更新", 409, {
      currentRevision: current.toString(),
      etag: sidebarEtag(current),
    });
  }
}

async function assertOwnedIcons(
  connection: PoolConnection,
  userId: string,
  assetIds: string[],
): Promise<void> {
  if (assetIds.length === 0) return;
  const placeholders = assetIds.map(() => "?").join(", ");
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT id FROM desktop_sidebar_assets
     WHERE userId = ? AND deletedAt IS NULL AND id IN (${placeholders})`,
    [userId, ...assetIds],
  );
  const owned = new Set(rows.map((row) => String(row.id)));
  const missing = assetIds.filter((id) => !owned.has(id));
  if (missing.length > 0) {
    throw new AiDirectHiringError(
      ErrorCodes.FORBIDDEN_SCOPE,
      "侧栏配置引用了不属于当前账号的 Logo",
      403,
      { assetIds: missing },
    );
  }
}

async function assertKnownTemplates(
  connection: PoolConnection,
  config: DesktopSidebarConfig,
): Promise<void> {
  const templateIds = [
    ...new Set(config.items.flatMap((item) => (item.templateId ? [item.templateId] : []))),
  ];
  if (templateIds.length === 0) return;
  const placeholders = templateIds.map(() => "?").join(", ");
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT id FROM desktop_templates WHERE id IN (${placeholders}) AND status <> 'deleted'`,
    templateIds,
  );
  const known = new Set(rows.map((row) => String(row.id)));
  const missing = templateIds.filter((id) => !known.has(id));
  if (missing.length > 0) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "侧栏配置引用了未知模板", 400, {
      templateIds: missing,
    });
  }
}

async function findOwnedAsset(
  fastify: FastifyInstance,
  userId: string,
  id: string,
): Promise<SidebarAssetRow> {
  const [rows] = await fastify.mysql.query<SidebarAssetRow[]>(
    `SELECT * FROM desktop_sidebar_assets
     WHERE id = ? AND userId = ? AND deletedAt IS NULL
     LIMIT 1`,
    [id, userId],
  );
  if (!rows[0]) {
    throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "Logo 资源不存在", 404);
  }
  return rows[0];
}

function parseStoredConfig(value: string | DesktopSidebarConfig): DesktopSidebarConfig {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  return parseDesktopSidebarConfig(parsed);
}

async function discardStoredAsset(
  assetStore: ManagedAssetStore,
  stored: StoredManagedAsset,
): Promise<void> {
  try {
    const trashName = await assetStore.moveToTrash(stored.storageKey);
    await assetStore.deleteFromTrash(trashName);
  } catch {
    // Database metadata is authoritative; an unreferenced managed file is safe to clean later.
  }
}
