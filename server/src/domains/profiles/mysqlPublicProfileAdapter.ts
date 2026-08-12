import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { PublicProfile, PublicProfilePort } from './publicProfilePort.js';

type ProfileSnapshotRow = RowDataPacket & {
  legacyConvexId: string;
  handle: string | null;
  profileSlug: string | null;
  name: string | null;
  displayName: string | null;
  bio: string | null;
  image: string | null;
  legacyCreationTime: number | bigint;
};

const profileFromRow = (row: ProfileSnapshotRow): PublicProfile => ({
  user: {
    _id: row.legacyConvexId,
    _creationTime: Number(row.legacyCreationTime),
    ...(row.handle ? { handle: row.handle } : {}),
    ...(row.name ? { name: row.name } : {}),
    ...(row.displayName ? { displayName: row.displayName } : {}),
    ...(row.image ? { image: row.image } : {}),
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
        `SELECT legacyConvexId, handle, profileSlug, name, displayName, bio, image, legacyCreationTime
         FROM profile_snapshots
         WHERE deletedAt IS NULL
           AND deactivatedAt IS NULL
           AND (profileSlug = ? OR (profileSlug IS NULL AND handle = ?))
         LIMIT 1`,
        [slug, slug],
      );
      const row = rows[0];
      return row ? profileFromRow(row) : null;
    },
  });