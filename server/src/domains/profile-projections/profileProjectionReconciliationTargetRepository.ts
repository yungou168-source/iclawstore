import type {
  ProfileProjectionCatalogSourceSnapshot,
  ProfileProjectionStarredSourceSnapshot,
} from './profileProjectionMigrationSource.js';
import type { ProfileProjectionManifestSource } from './profileProjectionPort.js';
import type { ProfileProjectionReconciliationPhase } from './profileProjectionReconciliation.js';

type SqlConnection = Readonly<{
  query: (sql: string, values?: readonly unknown[]) => Promise<unknown>;
}>;

type DateValue = Date | string;
type CatalogRow = Readonly<{
  publisherLegacyConvexId: string;
  publisherHandle: string;
  legacyConvexId: string;
  kind: 'skill' | 'plugin';
  slug: string | null;
  displayName: string;
  summary: string | null;
  icon: string | null;
  sourceHref: string;
  downloads: number | bigint | string;
  stars: number | bigint | string;
  isOfficial: boolean | number;
  legacyUpdatedAt: DateValue;
  sourceGitHubId: string | null;
  sourcePath: string | null;
}>;
type StarredRow = Omit<CatalogRow, 'publisherLegacyConvexId' | 'publisherHandle' | 'legacyConvexId' | 'kind' | 'slug' | 'sourceGitHubId' | 'sourcePath' | 'legacyUpdatedAt'> & Readonly<{
  viewerUserLegacyConvexId: string;
  skillLegacyConvexId: string;
  starredAt: DateValue;
  skillUpdatedAt: DateValue;
}>;
type ManifestRow = Readonly<{
  id: string;
  sourceGitHubLegacyConvexId: string;
  publisherLegacyConvexId: string;
  repo: string;
  status: 'ok' | 'missing' | 'invalid' | 'failed';
  verifiedCommit: string | null;
  notGrouped: 'top' | 'bottom' | null;
  legacyUpdatedAt: DateValue;
}>;
type SectionRow = Readonly<{ id: string; position: number; title: string; description: string | null }>;
type EntryRow = Readonly<{ sectionId: string; position: number; manifestSkillKey: string }>;

type Snapshot = ProfileProjectionCatalogSourceSnapshot | ProfileProjectionStarredSourceSnapshot | ProfileProjectionManifestSource;

const rows = <T>(result: unknown): readonly T[] =>
  Array.isArray(result) && Array.isArray(result[0]) ? result[0] as T[] : [];
const number = (value: number | bigint | string): number => Number(value);
const millis = (value: DateValue): number => value instanceof Date ? value.getTime() : new Date(value).getTime();
const placeholders = (values: readonly string[]): string => values.map(() => '?').join(',');

const catalogSnapshot = (row: CatalogRow): ProfileProjectionCatalogSourceSnapshot => ({
  publisherLegacyConvexId: row.publisherLegacyConvexId,
  publisherHandle: row.publisherHandle,
  item: {
    legacyConvexId: row.legacyConvexId, kind: row.kind, slug: row.slug,
    displayName: row.displayName, summary: row.summary, icon: row.icon, href: row.sourceHref,
    canonicalStats: { downloads: number(row.downloads), stars: number(row.stars) },
    isOfficial: Boolean(row.isOfficial), updatedAt: millis(row.legacyUpdatedAt),
    sourceGitHubId: row.sourceGitHubId, sourcePath: row.sourcePath,
  },
});

const listCatalog = async (connection: SqlConnection, source: readonly ProfileProjectionCatalogSourceSnapshot[]) => {
  const ids = source.map(({ item }) => item.legacyConvexId);
  if (ids.length === 0) return [];
  const result = await connection.query(
    `SELECT publisher.legacyConvexId AS publisherLegacyConvexId,publisher.handle AS publisherHandle,
            item.legacyConvexId,item.kind,item.slug,item.displayName,item.summary,item.icon,item.sourceHref,
            item.downloads,item.stars,item.isOfficial,item.legacyUpdatedAt,item.sourceGitHubId,item.sourcePath
     FROM profile_catalog_items item INNER JOIN publisher_snapshots publisher ON publisher.id = item.publisherId
     WHERE item.legacyConvexId IN (${placeholders(ids)})`, ids,
  );
  return rows<CatalogRow>(result).map(catalogSnapshot);
};

const listStarred = async (connection: SqlConnection, source: readonly ProfileProjectionStarredSourceSnapshot[]) => {
  if (source.length === 0) return [];
  const predicates = source.map(() => '(viewerUserLegacyConvexId = ? AND skillLegacyConvexId = ?)').join(' OR ');
  const values = source.flatMap((item) => [item.viewerUserLegacyConvexId, item.item.legacyConvexId]);
  const result = await connection.query(
    `SELECT viewerUserLegacyConvexId,skillLegacyConvexId,displayName,summary,icon,sourceHref,isOfficial,
            downloads,stars,starredAt,skillUpdatedAt
     FROM profile_starred_items WHERE ${predicates}`,
    values,
  );
  return rows<StarredRow>(result).map((row) => ({
    viewerUserLegacyConvexId: row.viewerUserLegacyConvexId,
    starredAt: millis(row.starredAt),
    item: {
      legacyConvexId: row.skillLegacyConvexId, kind: 'skill' as const, displayName: row.displayName,
      summary: row.summary, icon: row.icon, href: row.sourceHref,
      canonicalStats: { downloads: number(row.downloads), stars: number(row.stars) },
      isOfficial: Boolean(row.isOfficial), updatedAt: millis(row.skillUpdatedAt),
    },
  }));
};

const listManifests = async (connection: SqlConnection, source: readonly ProfileProjectionManifestSource[]) => {
  const ids = source.map((item) => item.sourceGitHubLegacyConvexId);
  if (ids.length === 0) return [];
  const manifests = rows<ManifestRow>(await connection.query(
    `SELECT manifest.id,manifest.sourceGitHubLegacyConvexId,publisher.legacyConvexId AS publisherLegacyConvexId,
            manifest.repo,manifest.status,manifest.verifiedCommit,manifest.notGrouped,manifest.legacyUpdatedAt
     FROM profile_catalog_manifests manifest INNER JOIN publisher_snapshots publisher ON publisher.id = manifest.publisherId
     WHERE manifest.sourceGitHubLegacyConvexId IN (${placeholders(ids)})`, ids,
  ));
  return Promise.all(manifests.map(async (manifest) => {
    const sections = rows<SectionRow>(await connection.query(
      'SELECT id,position,title,description FROM profile_catalog_manifest_sections WHERE manifestId = ? ORDER BY position ASC',
      [manifest.id],
    ));
    const entries = rows<EntryRow>(await connection.query(
      `SELECT entry.sectionId,entry.position,entry.manifestSkillKey
       FROM profile_catalog_manifest_entries entry
       INNER JOIN profile_catalog_manifest_sections section ON section.id = entry.sectionId
       WHERE section.manifestId = ? ORDER BY entry.sectionId ASC,entry.position ASC`,
      [manifest.id],
    ));
    return {
      sourceGitHubLegacyConvexId: manifest.sourceGitHubLegacyConvexId,
      publisherLegacyConvexId: manifest.publisherLegacyConvexId,
      repo: manifest.repo, status: manifest.status, verifiedCommit: manifest.verifiedCommit,
      notGrouped: manifest.notGrouped, updatedAt: millis(manifest.legacyUpdatedAt),
      sections: sections.map((section) => ({
        position: section.position, title: section.title, description: section.description,
        entries: entries.filter((entry) => entry.sectionId === section.id).map((entry) => ({
          position: entry.position, skillKey: entry.manifestSkillKey,
        })),
      })),
    };
  }));
};

export const createProfileProjectionReconciliationTarget = (connection: SqlConnection) => Object.freeze({
  list: async (phase: ProfileProjectionReconciliationPhase, source: readonly Snapshot[]): Promise<readonly Snapshot[]> => {
    if (phase === 'catalog' || phase === 'packages') {
      return listCatalog(connection, source as readonly ProfileProjectionCatalogSourceSnapshot[]);
    }
    if (phase === 'starred') return listStarred(connection, source as readonly ProfileProjectionStarredSourceSnapshot[]);
    return listManifests(connection, source as readonly ProfileProjectionManifestSource[]);
  },
});