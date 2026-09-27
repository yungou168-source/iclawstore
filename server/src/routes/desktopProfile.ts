import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { requireAuth } from '../middleware/aiDirectAuth.js';
import { AiDirectHiringError, ErrorCodes } from '../services/aiDirectErrors.js';
import {
  managedAssetDownloadHeaders,
  type ManagedAssetStore,
  type StoredManagedAsset,
} from '../services/managedAssetStore.js';

type ProfileRow = RowDataPacket & {
  id: string;
  handle: string | null;
  displayName: string | null;
  bio: string | null;
  image: string | null;
  revision: string | number | bigint | null;
  updatedAt: Date | null;
};

type ProfileAssetRow = RowDataPacket & {
  id: string;
  storageKey: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: string | number | bigint;
  sha256: string;
};

type ProfilePatch = {
  displayName?: string | null;
  bio?: string | null;
  avatarAssetId?: string | null;
};

const profileEtag = (revision: string | number | bigint) => `"profile-${String(revision)}"`;

const optionalText = (value: unknown, field: string, maxLength: number): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 无效`);
  }
  return value;
};

const parseIfMatch = (value: unknown): bigint => {
  if (typeof value !== 'string') {
    throw new AiDirectHiringError(ErrorCodes.PRECONDITION_REQUIRED, '更新资料必须提供 If-Match', 428);
  }
  const match = /^"profile-([0-9]+)"$/.exec(value.trim());
  if (!match) {
    throw new AiDirectHiringError(ErrorCodes.PRECONDITION_REQUIRED, 'If-Match 格式无效', 428);
  }
  return BigInt(match[1]);
};

const parsePatch = (body: unknown): ProfilePatch => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '资料请求体必须是对象');
  }
  const raw = body as Record<string, unknown>;
  const keys = Object.keys(raw);
  if (keys.some((key) => !['displayName', 'bio', 'avatarAssetId'].includes(key))) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '资料包含不可编辑字段');
  }
  const avatarAssetId = optionalText(raw.avatarAssetId, 'avatarAssetId', 36);
  if (avatarAssetId !== undefined && avatarAssetId !== null && !/^[a-f0-9-]{36}$/i.test(avatarAssetId)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'avatarAssetId 无效');
  }
  const patch = {
    displayName: optionalText(raw.displayName, 'displayName', 191),
    bio: optionalText(raw.bio, 'bio', 2000),
    avatarAssetId,
  };
  if (Object.values(patch).every((value) => value === undefined)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '至少提供一个可编辑字段');
  }
  return patch;
};

export function createDesktopProfileRoutes(assetStore: ManagedAssetStore) {
  return async function desktopProfileRoutes(fastify: FastifyInstance): Promise<void> {
    fastify.get('/profile', async (request, reply) => {
      const user = await requireAuth(fastify, request);
      const profile = await readProfile(fastify, user.id);
      reply.header('ETag', profileEtag(profile.revision ?? 0));
      return reply.send(profileResponse(profile));
    });

    fastify.put('/profile', async (request, reply) => {
      const user = await requireAuth(fastify, request);
      const expectedRevision = parseIfMatch(request.headers['if-match']);
      const patch = parsePatch(request.body);
      const connection = await fastify.mysql.getConnection();
      try {
        await connection.beginTransaction();
        const profile = await lockProfile(connection, user.id);
        const revision = BigInt(profile.revision ?? 0);
        if (expectedRevision !== revision) {
          throw new AiDirectHiringError(ErrorCodes.REVISION_CONFLICT, '资料已被其他设备更新', 409, {
            currentRevision: revision.toString(),
            etag: profileEtag(revision),
          });
        }
        const avatarUrl = await resolveAvatarUrl(connection, user.id, patch.avatarAssetId);
        const nextRevision = revision + 1n;
        await connection.query(
          `UPDATE users SET
             displayName = CASE WHEN ? = 1 THEN ? ELSE displayName END,
             bio = CASE WHEN ? = 1 THEN ? ELSE bio END,
             image = CASE WHEN ? = 1 THEN ? ELSE image END,
             updatedAt = NOW(3)
           WHERE id = ?`,
          [
            patch.displayName === undefined ? 0 : 1,
            patch.displayName ?? null,
            patch.bio === undefined ? 0 : 1,
            patch.bio ?? null,
            patch.avatarAssetId === undefined ? 0 : 1,
            avatarUrl ?? null,
            user.id,
          ],
        );
        await connection.query(
          `INSERT INTO desktop_profile_revisions (userId, revision, updatedAt) VALUES (?, ?, NOW(3))
           ON DUPLICATE KEY UPDATE revision = VALUES(revision), updatedAt = NOW(3)`,
          [user.id, nextRevision.toString()],
        );
        await connection.commit();
        const updated = await readProfile(fastify, user.id);
        reply.header('ETag', profileEtag(nextRevision));
        return reply.send(profileResponse(updated));
      } catch (error) {
        await connection.rollback().catch(() => undefined);
        throw error;
      } finally {
        connection.release();
      }
    });

    fastify.post('/profile/avatar', async (request, reply) => {
      const user = await requireAuth(fastify, request);
      const part = await request.file();
      if (!part) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '必须上传头像文件');
      const stored = await assetStore.store({
        kind: 'avatar', originalFileName: part.filename, declaredMimeType: part.mimetype, stream: part.file,
      });
      const id = randomUUID();
      try {
        await fastify.mysql.query(
          `INSERT INTO desktop_profile_assets
           (id, userId, storageKey, originalFileName, mimeType, sizeBytes, sha256, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3))`,
          [id, user.id, stored.storageKey, stored.originalFileName, stored.mimeType, stored.sizeBytes, stored.sha256],
        );
      } catch (error) {
        await discardStoredAsset(assetStore, stored);
        throw error;
      }
      return reply.status(201).send({
        id, mimeType: stored.mimeType, sizeBytes: stored.sizeBytes, sha256: stored.sha256,
        contentUrl: `/api/v1/desktop/profile/avatar/${id}/content`,
      });
    });

    fastify.get('/profile/avatar/:assetId/content', async (request, reply) => {
      const { assetId } = request.params as { assetId: string };
      const [rows] = await fastify.mysql.query<ProfileAssetRow[]>(
        `SELECT a.id, a.storageKey, a.originalFileName, a.mimeType, a.sizeBytes, a.sha256
         FROM desktop_profile_assets a
         JOIN users u ON u.image = CONCAT('/api/v1/desktop/profile/avatar/', a.id, '/content')
         WHERE a.id = ? AND a.deletedAt IS NULL LIMIT 1`,
        [assetId],
      );
      const asset = rows[0];
      if (!asset) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, '头像资源不存在', 404);
      const opened = await assetStore.open(asset.storageKey);
      reply.headers(managedAssetDownloadHeaders({ mimeType: asset.mimeType, sha256: asset.sha256 }));
      reply.header('Content-Length', String(opened.sizeBytes));
      return reply.send(opened.stream);
    });
  };
}

async function readProfile(fastify: FastifyInstance, userId: string): Promise<ProfileRow> {
  const [rows] = await fastify.mysql.query<ProfileRow[]>(
    `SELECT u.id, u.handle, u.displayName, u.bio, u.image, r.revision, r.updatedAt
     FROM users u LEFT JOIN desktop_profile_revisions r ON r.userId = u.id WHERE u.id = ? LIMIT 1`, [userId],
  );
  const profile = rows[0];
  if (!profile) throw new AiDirectHiringError(ErrorCodes.AUTH_REQUIRED, '账号不可用', 401);
  return profile;
}

async function lockProfile(connection: PoolConnection, userId: string): Promise<ProfileRow> {
  const [rows] = await connection.query<ProfileRow[]>(
    `SELECT u.id, u.handle, u.displayName, u.bio, u.image, r.revision, r.updatedAt
     FROM users u LEFT JOIN desktop_profile_revisions r ON r.userId = u.id WHERE u.id = ? LIMIT 1 FOR UPDATE`, [userId],
  );
  const profile = rows[0];
  if (!profile) throw new AiDirectHiringError(ErrorCodes.AUTH_REQUIRED, '账号不可用', 401);
  return profile;
}

async function resolveAvatarUrl(connection: PoolConnection, userId: string, assetId: string | null | undefined): Promise<string | null | undefined> {
  if (assetId === undefined) return undefined;
  if (assetId === null) return null;
  const [rows] = await connection.query<ProfileAssetRow[]>(
    'SELECT id, storageKey, originalFileName, mimeType, sizeBytes, sha256 FROM desktop_profile_assets WHERE id = ? AND userId = ? AND deletedAt IS NULL LIMIT 1 FOR UPDATE',
    [assetId, userId],
  );
  if (!rows[0]) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, '头像资源不存在', 404);
  return `/api/v1/desktop/profile/avatar/${assetId}/content`;
}

function profileResponse(profile: ProfileRow) {
  return {
    id: profile.id, handle: profile.handle, displayName: profile.displayName, bio: profile.bio, image: profile.image,
    revision: String(profile.revision ?? 0), updatedAt: profile.updatedAt ?? null,
  };
}

async function discardStoredAsset(assetStore: ManagedAssetStore, stored: StoredManagedAsset): Promise<void> {
  try {
    const trashName = await assetStore.moveToTrash(stored.storageKey);
    assetStore.scheduleTrashCleanup(trashName, 0);
  } catch {
    // A failed database insert must not obscure the primary error.
  }
}