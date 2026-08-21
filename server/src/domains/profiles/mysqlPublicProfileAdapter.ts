import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { PublicProfile, PublicProfilePort } from './publicProfilePort.js';

type ProfileSnapshotRow = RowDataPacket & {
  legacyConvexId: string;
  handle: string | null;
  profileSlug: string | null;
  name: string | null;
  displayName: string | null;
  bio: string | null;
  targetAssetId: string | null;
  legacyCreationTime: number | bigint;
};

const profileFromRow = (row: ProfileSnapshotRow): PublicProfile => ({
  user: {
    _id: row.legacyConvexId,
    _creationTime: Number(row.legacyCreationTime),
    ...(row.handle ? { handle: row.handle } : {}),
    ...(row.name ? { name: row.name } : {}),
    ...(row.displayName ? { displayName: row.displayName } : {}),
    ...(row.targetAssetId ? { image: `/api/profile-assets/${encodeURIComponent(row.targetAssetId)}/content` } : {}),
    ...(row.bio ? { bio: row.bio } : {}),
  },
  profileSlug: row.profileSlug ?? row.handle ?? '',
  publisher: null,
});

export const createMysqlPublicProfileAdapter = (pool: Pool): PublicProfilePort =>
  Object.freeze({
    getBySlug: async (rawSlug) => {
      const slug = rawSlug.trim().toLowerCase();
      if (!slug) return null;
      const [rows] = await pool.query<ProfileSnapshotRow[]>(
        `SELECT p.legacyConvexId, p.handle, p.profileSlug, p.name, p.displayName, p.bio,
                a.targetAssetId, p.legacyCreationTime
         FROM profile_snapshots p
         LEFT JOIN profile_asset_snapshots a
           ON a.profileId = p.id AND a.status = 'active'
         LEFT JOIN profile_identity_aliases i
           ON i.profileId = p.id
         WHERE p.deletedAt IS NULL
           AND p.deactivatedAt IS NULL
           AND (
             p.profileSlug = ?
             OR (p.profileSlug IS NULL AND p.handle = ?)
             OR i.aliasValue = ?
           )
         ORDER BY (p.profileSlug = ?) DESC, i.isCanonical DESC
         LIMIT 1`,
        [slug, slug, slug, slug],
      );
      const row = rows[0];
      return row ? profileFromRow(row) : null;
    },
  });