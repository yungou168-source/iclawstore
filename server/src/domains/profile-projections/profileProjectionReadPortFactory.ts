import { createHash, randomUUID } from 'node:crypto';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type {
  ProfileProjectionCatalogDisplay,
  ProfileProjectionCatalogItem,
  ProfileProjectionPage,
  ProfileProjectionQuery,
  ProfileProjectionReadPort,
  ProfileProjectionStarredPage,
} from './profileProjectionPort.js';

export type ProfileProjectionReadMode = 'convex' | 'compare' | 'mysql' | 'mysql_authoritative';

export const profileProjectionReadModeFromEnvironment = (
  environment: NodeJS.ProcessEnv = process.env,
): ProfileProjectionReadMode => {
  const value = environment.PROFILE_PROJECTION_READ_MODE?.trim().toLowerCase();
  return value === 'compare' || value === 'mysql' || value === 'mysql_authoritative' || value === 'convex'
    ? value
    : 'convex';
};

type CatalogRow = RowDataPacket & {
  legacyConvexId: string; kind: 'skill' | 'plugin'; displayName: string; summary: string | null;
  icon: string | null; sourceHref: string; ownerHandle: string; downloads: number | bigint; stars: number | bigint;
  isOfficial: number | boolean; legacyUpdatedAt: Date; sourceGitHubId: string | null;
  sourceRepo: string | null; sourcePath: string | null; sourceVerifiedCommit: string | null;
};
type ManifestDisplayRow = CatalogRow & Readonly<{
  manifestId: string; manifestLegacyId: string; manifestRepo: string; notGrouped: 'top' | 'bottom' | null;
  sectionId: string | null; sectionPosition: number | null; sectionTitle: string | null;
  sectionDescription: string | null; entryPosition: number | null;
}>;
type MutableManifestSection = {
  key: string;
  title: string;
  description: string | null;
  sourceRepo: string | null;
  items: ProfileProjectionCatalogItem[];
};

const catalogReference = makeFunctionReference<'query', ProfileProjectionQuery, ProfileProjectionPage>('publishers:listPublishedPage');
const starredReference = makeFunctionReference<'query', Omit<ProfileProjectionQuery, 'kind'>, ProfileProjectionStarredPage>('publishers:listStarredPage');
const displayReference = makeFunctionReference<'query', Omit<ProfileProjectionQuery, 'paginationOpts'>, ProfileProjectionCatalogDisplay | null>('publishers:getPublishedDisplayManifest');

const toItem = (row: CatalogRow): ProfileProjectionCatalogItem => ({
  _id: row.legacyConvexId,
  kind: row.kind,
  displayName: row.displayName,
  summary: row.summary,
  icon: row.icon,
  href: row.sourceHref,
  downloads: Number(row.downloads),
  stars: Number(row.stars),
  isOfficial: Boolean(row.isOfficial),
  updatedAt: row.legacyUpdatedAt.getTime(),
  sourceBacked: row.sourceGitHubId !== null,
  sourceRepo: row.sourceRepo,
  sourcePath: row.sourcePath,
  sourceVerifiedCommit: row.sourceVerifiedCommit,
});

const mysqlCatalog = async (pool: Pool, query: ProfileProjectionQuery): Promise<ProfileProjectionPage> => {
  const offset = query.paginationOpts.cursor ? Number(query.paginationOpts.cursor) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Projection cursor is invalid');
  const [rows] = await pool.query<CatalogRow[]>(
    `SELECT item.legacyConvexId,item.kind,item.displayName,item.summary,item.icon,item.sourceHref,item.ownerHandle,
            item.downloads,item.stars,item.isOfficial,item.legacyUpdatedAt,item.sourceGitHubId,
            item.sourceRepo,item.sourcePath,item.sourceVerifiedCommit
     FROM profile_catalog_items item
     INNER JOIN publisher_snapshots publisher ON publisher.id = item.publisherId
     WHERE publisher.handle = ? AND item.sourceMissingAt IS NULL AND item.deletedAt IS NULL
       AND (? IS NULL OR item.kind = ?)
     ORDER BY ${query.sort === 'recent' ? 'item.legacyUpdatedAt DESC, item.downloads DESC' : 'item.downloads DESC, item.stars DESC, item.legacyUpdatedAt DESC'}, item.legacyConvexId ASC
     LIMIT ? OFFSET ?`,
    [query.handle, query.kind ?? null, query.kind ?? null, query.paginationOpts.numItems + 1, offset],
  );
  const page = rows.slice(0, query.paginationOpts.numItems).map(toItem);
  const isDone = rows.length <= query.paginationOpts.numItems;
  return { page, continueCursor: isDone ? '' : String(offset + page.length), isDone };
};

const mysqlCatalogDisplay = async (
  pool: Pool,
  query: Omit<ProfileProjectionQuery, 'paginationOpts'>,
): Promise<ProfileProjectionCatalogDisplay | null> => {
  const [rows] = await pool.query<ManifestDisplayRow[]>(
    `SELECT item.legacyConvexId,item.kind,item.displayName,item.summary,item.icon,item.sourceHref,item.ownerHandle,
            item.downloads,item.stars,item.isOfficial,item.legacyUpdatedAt,item.sourceGitHubId,
            item.sourceRepo,item.sourcePath,item.sourceVerifiedCommit,
            manifest.id AS manifestId,manifest.sourceGitHubLegacyConvexId AS manifestLegacyId,
            manifest.repo AS manifestRepo,manifest.notGrouped,
            section.id AS sectionId,section.position AS sectionPosition,section.title AS sectionTitle,
            section.description AS sectionDescription,entry.position AS entryPosition
     FROM profile_catalog_manifests manifest
     INNER JOIN publisher_snapshots publisher ON publisher.id = manifest.publisherId
     LEFT JOIN profile_catalog_manifest_sections section ON section.manifestId = manifest.id
     LEFT JOIN profile_catalog_manifest_entries entry ON entry.sectionId = section.id
     LEFT JOIN profile_catalog_items item ON item.id = entry.catalogItemId
       AND item.publisherId = manifest.publisherId AND item.kind = 'skill'
       AND item.deletedAt IS NULL AND item.sourceMissingAt IS NULL
     WHERE publisher.handle = ? AND manifest.status = 'ok' AND manifest.sourceMissingAt IS NULL
     ORDER BY manifest.legacyUpdatedAt ASC,manifest.sourceGitHubLegacyConvexId ASC,
              section.position ASC,entry.position ASC`,
    [query.handle],
  );
  if (rows.length === 0) return null;

  const sourceRepos: string[] = [];
  const sections: MutableManifestSection[] = [];
  const usedItemIds = new Set<string>();
  const manifestPosition = new Map<string, 'top' | 'bottom' | null>();
  const seenRepos = new Set<string>();
  for (const row of rows) {
    if (!seenRepos.has(row.manifestRepo)) {
      seenRepos.add(row.manifestRepo);
      sourceRepos.push(row.manifestRepo);
      manifestPosition.set(row.manifestId, row.notGrouped);
    }
    if (!row.sectionId || !row.legacyConvexId || row.sectionPosition === null || row.entryPosition === null) continue;
    const key = `${row.manifestLegacyId}:${row.sectionPosition}:${row.sectionTitle ?? ''}`;
    let section = sections.find((candidate) => candidate.key === key);
    if (!section) {
      section = {
        key,
        title: row.sectionTitle ?? '',
        description: row.sectionDescription,
        sourceRepo: row.manifestRepo,
        items: [],
      };
      sections.push(section);
    }
    if (!usedItemIds.has(row.legacyConvexId)) {
      usedItemIds.add(row.legacyConvexId);
      section.items.push(toItem(row));
    }
  }

  const renderableSections = sections.filter((section) => section.items.length > 0);
  const [otherRows] = await pool.query<CatalogRow[]>(
    `SELECT item.legacyConvexId,item.kind,item.displayName,item.summary,item.icon,item.sourceHref,item.ownerHandle,
            item.downloads,item.stars,item.isOfficial,item.legacyUpdatedAt,item.sourceGitHubId,
            item.sourceRepo,item.sourcePath,item.sourceVerifiedCommit
     FROM profile_catalog_items item INNER JOIN publisher_snapshots publisher ON publisher.id = item.publisherId
     WHERE publisher.handle = ? AND item.kind = 'skill' AND item.deletedAt IS NULL AND item.sourceMissingAt IS NULL
     ORDER BY ${query.sort === 'recent' ? 'item.legacyUpdatedAt DESC, item.downloads DESC' : 'item.downloads DESC, item.stars DESC, item.legacyUpdatedAt DESC'}, item.legacyConvexId ASC`,
    [query.handle],
  );
  const otherItems = otherRows.filter((row) => !usedItemIds.has(row.legacyConvexId)).map(toItem);
  const otherSection = otherItems.length === 0 ? null : {
    key: 'other-skills', title: 'Other skills', description: null, sourceRepo: null, items: otherItems,
  };
  const otherAtTop = [...manifestPosition.values()].some((position) => position === 'top');
  const orderedSections = otherAtTop && otherSection
    ? [otherSection, ...renderableSections]
    : [...renderableSections, ...(otherSection ? [otherSection] : [])];
  return orderedSections.length === 0 ? null : { mode: 'grouped', sourceRepos, sections: orderedSections };
};
export const createConvexProfileProjectionReadPort = (client: Pick<ConvexHttpClient, 'query'>): ProfileProjectionReadPort => Object.freeze({
  listCatalog: (query) => client.query(catalogReference, query),
  listStarred: (query) => client.query(starredReference, query),
  getCatalogDisplay: (query) => client.query(displayReference, query),
});

export const createMysqlProfileProjectionReadPort = (pool: Pool): ProfileProjectionReadPort => Object.freeze({
  listCatalog: (query) => mysqlCatalog(pool, query),
  listStarred: async (query) => {
    const offset = query.paginationOpts.cursor ? Number(query.paginationOpts.cursor) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Projection cursor is invalid');
    const [rows] = await pool.query<(CatalogRow & { starredAt: Date })[]>(
      `SELECT item.skillLegacyConvexId AS legacyConvexId, 'skill' AS kind, item.displayName,item.summary,item.icon,item.sourceHref,item.ownerHandle,
              item.downloads,item.stars,item.isOfficial,item.skillUpdatedAt AS legacyUpdatedAt,NULL AS sourceGitHubId,
              NULL AS sourceRepo,NULL AS sourcePath,NULL AS sourceVerifiedCommit,item.starredAt
       FROM profile_starred_items item INNER JOIN profile_snapshots profile ON profile.id = item.viewerProfileId
       WHERE profile.handle = ? AND item.sourceMissingAt IS NULL AND item.deletedAt IS NULL
       ORDER BY ${query.sort === 'recent' ? 'item.skillUpdatedAt DESC' : 'item.downloads DESC, item.stars DESC'}, item.skillLegacyConvexId ASC
       LIMIT ? OFFSET ?`,
      [query.handle, query.paginationOpts.numItems + 1, offset],
    );
    const page = rows.slice(0, query.paginationOpts.numItems).map((row) => ({ ...toItem(row), starredAt: row.starredAt.getTime() }));
    const isDone = rows.length <= query.paginationOpts.numItems;
    return { page, continueCursor: isDone ? '' : String(offset + page.length), isDone };
  },
  getCatalogDisplay: (query) => mysqlCatalogDisplay(pool, query),
});

const recordCompareDifference = async (pool: Pool, key: string, summary: string): Promise<void> => {
  await pool.query(
    `INSERT INTO convex_exit_reconciliation_records (id,recordKey,domain,legacyConvexId,fieldName,differenceKind,classification,summary)
     VALUES (?,?,?,?,?,'value_mismatch','unclassified',?)
     ON DUPLICATE KEY UPDATE summary=VALUES(summary),observedAt=CURRENT_TIMESTAMP(3),resolvedAt=NULL`,
    [randomUUID(), createHash('sha256').update(key).digest('hex'), 'profile_projections', key, 'public_read', summary],
  );
};

export const createCompareProfileProjectionReadPort = (
  convex: ProfileProjectionReadPort,
  mysql: ProfileProjectionReadPort,
  pool: Pool,
  log: Pick<Console, 'warn'> = console,
): ProfileProjectionReadPort => {
  const compare = <T>(name: string, source: () => Promise<T>, target: () => Promise<T>): Promise<T> => source().then(async (value) => {
    try {
      if (JSON.stringify(value) !== JSON.stringify(await target())) await recordCompareDifference(pool, name, `${name} differs`);
    } catch (error) { log.warn({ error, name }, 'Profile projection compare target failed'); }
    return value;
  });
  return Object.freeze({
    listCatalog: (query) => compare(`catalog:${query.handle}:${query.kind ?? 'all'}:${query.paginationOpts.cursor ?? 'initial'}`, () => convex.listCatalog(query), () => mysql.listCatalog(query)),
    listStarred: (query) => compare(`starred:${query.handle}:${query.paginationOpts.cursor ?? 'initial'}`, () => convex.listStarred(query), () => mysql.listStarred(query)),
    getCatalogDisplay: (query) => compare(`manifest:${query.handle}:${query.kind ?? 'all'}`, () => convex.getCatalogDisplay(query), () => mysql.getCatalogDisplay(query)),
  });
};

export const createProfileProjectionReadPort = (input: Readonly<{ mode: ProfileProjectionReadMode; convex: ProfileProjectionReadPort; mysql?: ProfileProjectionReadPort; pool?: Pool; log?: Pick<Console, 'warn'> }>): ProfileProjectionReadPort => {
  if (input.mode === 'convex') return input.convex;
  if (!input.mysql) throw new Error('MySQL profile projection read port is required');
  if (input.mode === 'mysql_authoritative') return input.mysql;
  if (input.mode === 'mysql') return input.mysql;
  if (!input.pool) throw new Error('MySQL pool is required for profile projection compare mode');
  return createCompareProfileProjectionReadPort(input.convex, input.mysql, input.pool, input.log);
};