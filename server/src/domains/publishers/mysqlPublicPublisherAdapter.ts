import type { Pool, RowDataPacket } from "mysql2/promise";
import type {
  PublicPublisherListItem,
  PublicPublisherMember,
  PublicPublisherMembers,
  PublicPublisherPage,
  PublicPublisherPort,
  PublicPublisherStats,
  PublisherKind,
} from "./publicPublisherPort.js";

const MAX_PAGE_SIZE = 100;

type PublisherRow = RowDataPacket & {
  id: string;
  legacyConvexId: string;
  legacyCreationTime: number | bigint;
  kind: PublisherKind;
  handle: string;
  displayName: string;
  bio: string | null;
  sourceImageUrl: string | null;
  linkedUserLegacyConvexId: string | null;
  trustedPublisher: boolean | number;
  publishedSkills: number;
  publishedPackages: number;
  totalInstalls: number;
  totalDownloads: number;
  totalStars: number;
  skillTotalInstalls: number;
  skillTotalDownloads: number;
  skillTotalStars: number;
  officialId: string | null;
  publisherTargetAssetId: string | null;
  profileTargetAssetId: string | null;
};

type CountRow = RowDataPacket & {
  allCount: number | string;
  organizationCount: number | string;
  individualCount: number | string;
};

type MemberRow = RowDataPacket & {
  memberUserLegacyConvexId: string;
  role: PublicPublisherMember["role"];
  handle: string | null;
  profileSlug: string | null;
  name: string | null;
  displayName: string | null;
  image: string | null;
  profileTargetAssetId: string | null;
  officialId: string | null;
};

const normalizeHandle = (value: string): string => value.trim().replace(/^@+/, "").toLowerCase();

const clampPageSize = (value: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 25;
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_PAGE_SIZE);
};

const cursorOffset = (cursor: string | null): number => {
  const parsed = Number(cursor ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
};

const assetUrl = (domain: "profile" | "publisher", assetId: string): string =>
  domain === "profile"
    ? `/api/profile-assets/${encodeURIComponent(assetId)}/content`
    : `/api/publisher-assets/${encodeURIComponent(assetId)}/content`;

const imageFromRow = (row: PublisherRow): string | null => {
  if (row.kind === "org" && row.publisherTargetAssetId) {
    return assetUrl("publisher", row.publisherTargetAssetId);
  }
  if (row.profileTargetAssetId) return assetUrl("profile", row.profileTargetAssetId);
  return row.sourceImageUrl;
};

const statsFromRow = (row: PublisherRow): PublicPublisherStats => ({
  skills: Number(row.publishedSkills ?? 0),
  packages: Number(row.publishedPackages ?? 0),
  installs: Number(row.totalInstalls ?? row.skillTotalInstalls ?? 0),
  downloads: Number(row.totalDownloads ?? row.skillTotalDownloads ?? 0),
  stars: Number(row.totalStars ?? row.skillTotalStars ?? 0),
});

const publisherFromRow = (row: PublisherRow): PublicPublisherListItem => ({
  _id: row.legacyConvexId,
  _creationTime: Number(row.legacyCreationTime),
  kind: row.kind,
  handle: row.handle,
  displayName: row.displayName,
  image: imageFromRow(row),
  bio: row.bio,
  linkedUserId: row.linkedUserLegacyConvexId,
  ...(row.officialId ? { official: true } : {}),
  stats: statsFromRow(row),
  publishedItems: [],
});

const memberFromRow = (row: MemberRow): PublicPublisherMember => ({
  role: row.role,
  user: {
    _id: row.memberUserLegacyConvexId,
    handle: row.handle ?? row.profileSlug,
    displayName: row.displayName ?? row.name,
    image: row.profileTargetAssetId ? assetUrl("profile", row.profileTargetAssetId) : row.image,
    official: Boolean(row.officialId),
  },
});

const baseSelect = `SELECT p.id, p.legacyConvexId, p.legacyCreationTime, p.kind, p.handle, p.displayName,
       p.bio, p.sourceImageUrl, p.linkedUserLegacyConvexId, p.trustedPublisher,
       p.publishedSkills, p.publishedPackages, p.totalInstalls, p.totalDownloads, p.totalStars,
       p.skillTotalInstalls, p.skillTotalDownloads, p.skillTotalStars,
       o.id AS officialId,
       pa.targetAssetId AS publisherTargetAssetId,
       psa.targetAssetId AS profileTargetAssetId
 FROM publisher_snapshots p
 LEFT JOIN official_publisher_snapshots o ON o.publisherId = p.id
 LEFT JOIN publisher_avatar_snapshots pa ON pa.publisherId = p.id AND pa.status = 'active'
 LEFT JOIN profile_asset_snapshots psa ON psa.profileId = p.linkedProfileId AND psa.status = 'active'`;

const activePredicate = `p.deletedAt IS NULL
   AND p.deactivatedAt IS NULL
   AND p.sourceMissingAt IS NULL
   AND (p.kind = 'org' OR p.linkedProfileId IS NOT NULL)`;

export const createMysqlPublicPublisherAdapter = (pool: Pool): PublicPublisherPort =>
  Object.freeze({
    getProfileByHandle: async (rawHandle) => {
      const handle = normalizeHandle(rawHandle);
      if (!handle) return null;
      const [rows] = await pool.query<PublisherRow[]>(
        `${baseSelect}
         WHERE ${activePredicate} AND p.handle = ?
         LIMIT 1`,
        [handle],
      );
      const row = rows[0];
      return row ? publisherFromRow(row) : null;
    },

    listPublicPage: async (query): Promise<PublicPublisherPage> => {
      const limit = clampPageSize(query.paginationOpts.numItems);
      const offset = cursorOffset(query.paginationOpts.cursor);
      const search = query.query?.trim().toLowerCase() ?? "";
      const filters: string[] = [activePredicate, "(p.publishedSkills + p.publishedPackages) > 0"];
      const values: unknown[] = [];
      if (query.kind) {
        filters.push("p.kind = ?");
        values.push(query.kind);
      }
      if (search) {
        filters.push(
          "(LOWER(p.displayName) LIKE ? OR p.handle LIKE ? OR LOWER(COALESCE(p.bio, '')) LIKE ?)",
        );
        const pattern = `%${search}%`;
        values.push(pattern, pattern, pattern);
      }
      const where = filters.join(" AND ");
      const [rows] = await pool.query<PublisherRow[]>(
        `${baseSelect}
         WHERE ${where}
         ORDER BY p.totalDownloads DESC, p.totalStars DESC, (p.publishedSkills + p.publishedPackages) DESC, p.displayName ASC
         LIMIT ? OFFSET ?`,
        [...values, limit, offset],
      );
      const [[countRows], [globalRows]] = await Promise.all([
        pool.query<CountRow[]>(
          `SELECT COUNT(*) AS allCount,
                  SUM(p.kind = 'org') AS organizationCount,
                  SUM(p.kind = 'user') AS individualCount
           FROM publisher_snapshots p
           WHERE ${where}`,
          values,
        ),
        pool.query<CountRow[]>(
          `SELECT COUNT(*) AS allCount,
                  SUM(p.kind = 'org') AS organizationCount,
                  SUM(p.kind = 'user') AS individualCount
           FROM publisher_snapshots p
           WHERE ${activePredicate} AND (p.publishedSkills + p.publishedPackages) > 0`,
        ),
      ]);
      const counts = countRows[0];
      const globalCounts = globalRows[0];
      const nextOffset = offset + rows.length;
      return {
        page: rows.map(publisherFromRow),
        counts: {
          all: Number(counts?.allCount ?? 0),
          organizations: Number(counts?.organizationCount ?? 0),
          individuals: Number(counts?.individualCount ?? 0),
        },
        globalCounts: {
          all: Number(globalCounts?.allCount ?? 0),
          organizations: Number(globalCounts?.organizationCount ?? 0),
          individuals: Number(globalCounts?.individualCount ?? 0),
        },
        continueCursor: rows.length === limit ? String(nextOffset) : "",
        isDone: rows.length < limit,
      };
    },

    listMembers: async (rawHandle): Promise<PublicPublisherMembers | null> => {
      const handle = normalizeHandle(rawHandle);
      if (!handle) return null;
      const [publisherRows] = await pool.query<PublisherRow[]>(
        `${baseSelect}
         WHERE ${activePredicate} AND p.handle = ?
         LIMIT 1`,
        [handle],
      );
      const publisherRow = publisherRows[0];
      if (!publisherRow) return null;
      const [memberRows] = await pool.query<MemberRow[]>(
        `SELECT m.memberUserLegacyConvexId, m.role,
                ps.handle, ps.profileSlug, ps.name, ps.displayName, ps.image,
                psa.targetAssetId AS profileTargetAssetId,
                o.id AS officialId
         FROM publisher_member_snapshots m
         INNER JOIN profile_snapshots ps ON ps.id = m.memberProfileId
         LEFT JOIN profile_asset_snapshots psa ON psa.profileId = ps.id AND psa.status = 'active'
         LEFT JOIN publisher_snapshots personalPublisher
           ON personalPublisher.linkedUserLegacyConvexId = m.memberUserLegacyConvexId
          AND personalPublisher.deletedAt IS NULL
          AND personalPublisher.deactivatedAt IS NULL
          AND personalPublisher.sourceMissingAt IS NULL
         LEFT JOIN official_publisher_snapshots o ON o.publisherId = personalPublisher.id
         WHERE m.publisherId = ?
           AND ps.deletedAt IS NULL
           AND ps.deactivatedAt IS NULL
           AND ps.purgedAt IS NULL
         ORDER BY FIELD(m.role, 'owner', 'admin', 'publisher'), COALESCE(ps.displayName, ps.name, ps.handle, ps.profileSlug) ASC`,
        [publisherRow.id],
      );
      return { publisher: publisherFromRow(publisherRow), members: memberRows.map(memberFromRow) };
    },
  });
