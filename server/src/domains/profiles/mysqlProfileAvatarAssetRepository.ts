import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { ProfileAvatarAsset, ProfileAvatarAssetRepository } from './profileAvatarAssetImport.js';

type AssetRow = RowDataPacket & ProfileAvatarAsset;

const toAsset = (row: AssetRow): ProfileAvatarAsset => ({
  assetId: row.assetId,
  legacyStorageId: row.legacyStorageId,
  ownerLegacyConvexId: row.ownerLegacyConvexId,
  accessScope: 'public',
  storageKey: row.storageKey,
  originalFileName: row.originalFileName,
  mimeType: row.mimeType,
  sizeBytes: Number(row.sizeBytes),
  sha256: row.sha256,
  status: row.status === 'deleted' ? 'deleted' : 'active',
});

export const createMysqlProfileAvatarAssetRepository = (pool: Pool): ProfileAvatarAssetRepository =>
  Object.freeze({
    findByLegacyStorageId: async (legacyStorageId) => {
      const [rows] = await pool.query<AssetRow[]>(
        `SELECT id AS assetId, legacyStorageId, ownerLegacyConvexId, storageKey, originalFileName,
                mimeType, sizeBytes, sha256, status
         FROM convex_exit_managed_assets
         WHERE legacyStorageId = ? AND ownerDomain = 'profiles'
         LIMIT 1`,
        [legacyStorageId],
      );
      return rows[0] ? toAsset(rows[0]) : null;
    },
    save: async (asset) => {
      await pool.query(
        `INSERT INTO convex_exit_managed_assets
           (id, legacyStorageId, ownerDomain, ownerLegacyConvexId, accessScope,
            storageKey, originalFileName, mimeType, sizeBytes, sha256, status)
         VALUES (?, ?, 'profiles', ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           ownerLegacyConvexId = VALUES(ownerLegacyConvexId),
           accessScope = VALUES(accessScope), storageKey = VALUES(storageKey),
           originalFileName = VALUES(originalFileName), mimeType = VALUES(mimeType),
           sizeBytes = VALUES(sizeBytes), sha256 = VALUES(sha256), status = VALUES(status),
           deletedAt = IF(VALUES(status) = 'deleted', CURRENT_TIMESTAMP(3), NULL)`,
        [
          asset.assetId, asset.legacyStorageId, asset.ownerLegacyConvexId, asset.accessScope,
          asset.storageKey, asset.originalFileName, asset.mimeType, asset.sizeBytes, asset.sha256, asset.status,
        ],
      );
    },
  });