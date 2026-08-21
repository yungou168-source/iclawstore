import { createHash, randomUUID } from 'node:crypto';
import { createMigrationPort } from '../migration/migrationPort.js';
import type {
  ProfileProjectionCatalogSourceSnapshot,
  ProfileProjectionMigrationSource,
  ProfileProjectionStarredSourceSnapshot,
} from './profileProjectionMigrationSource.js';

type SqlExecutor = Readonly<{ query: (sql: string, values?: readonly unknown[]) => Promise<unknown> }>;
type Transaction = SqlExecutor & Readonly<{
  beginTransaction: () => Promise<void>;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
  release: () => void;
}>;
type Pool = SqlExecutor & Readonly<{ getConnection: () => Promise<Transaction> }>;
type Phase = 'catalog' | 'packages' | 'starred' | 'manifests';
export type ProfileProjectionSyncPhase = Phase;
type Cursor = Readonly<{ version: 1; phase: Phase; sourceCursor: string | null }>;
type Row = Readonly<{ targetId: string; publisherId?: string; sourceHash?: string }>;

export type ProfileProjectionSyncInput = Readonly<{
  pool: Pool;
  source: ProfileProjectionMigrationSource;
  batchId: string;
  batchSize: number;
  phase?: Phase;
  approvalRef?: string;
  requestedBy?: string;
}>;

export type ProfileProjectionSyncResult = Readonly<{
  batchId: string;
  phase: Phase;
  upserted: number;
  unchanged: number;
  done: boolean;
}>;

const rows = <T>(result: unknown): T[] =>
  Array.isArray(result) && Array.isArray(result[0]) ? (result[0] as T[]) : [];
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const required = (value: string, name: string) => {
  if (!value.trim()) throw new Error(`${name} is required`);
  return value;
};
const encodeCursor = (cursor: Cursor) => JSON.stringify(cursor);
const decodeCursor = (value: string | null): Cursor | null => {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value) as Partial<Cursor>;
    if (parsed.version !== 1 || !['catalog', 'packages', 'starred', 'manifests'].includes(parsed.phase ?? '') || (parsed.sourceCursor !== null && typeof parsed.sourceCursor !== 'string')) throw new Error();
    return parsed as Cursor;
  } catch { throw new Error('Profile projection sync cursor is invalid'); }
};
const migrationFor = (executor: SqlExecutor) => createMigrationPort(executor);

const nextCursor = (
  current: Cursor,
  page: Readonly<{ cursor: string | null; done: boolean }>,
): Cursor | null => {
  if (!page.done) {
    if (!page.cursor) throw new Error('Incomplete profile projection source page has no cursor');
    return { ...current, sourceCursor: page.cursor };
  }
  if (current.phase === 'catalog') return { version: 1, phase: 'packages', sourceCursor: null };
  if (current.phase === 'packages') return { version: 1, phase: 'starred', sourceCursor: null };
  if (current.phase === 'starred') return { version: 1, phase: 'manifests', sourceCursor: null };
  return null;
};

const resolveMap = async (executor: SqlExecutor, domain: 'profiles' | 'publishers', legacyId: string) => {
  const [row] = rows<Row>(await executor.query(
    `SELECT targetId FROM convex_exit_legacy_id_maps WHERE domain = ? AND legacyConvexId = ? LIMIT 1`, [domain, required(legacyId, `${domain} legacy ID`)],
  ));
  if (!row) throw new Error(`Missing ${domain === 'profiles' ? 'Profile' : 'Publisher'} legacy map: ${legacyId}`);
  return row.targetId;
};

const upsertCatalog = async (executor: SqlExecutor, batchId: string, snapshot: ProfileProjectionCatalogSourceSnapshot) => {
  const publisherId = await resolveMap(executor, 'publishers', snapshot.publisherLegacyConvexId);
  const sourceHash = hash(snapshot);
  const [existing] = rows<Row>(await executor.query(`SELECT id AS targetId, sourceHash FROM profile_catalog_items WHERE legacyConvexId = ? LIMIT 1`, [snapshot.item.legacyConvexId]));
  const id = existing?.targetId ?? randomUUID();
  if (existing?.sourceHash === sourceHash) {
    await executor.query('UPDATE profile_catalog_items SET lastSeenBatchId = ?, sourceMissingAt = NULL WHERE id = ?', [batchId, id]);
    return 'unchanged';
  }
  await executor.query(
    `INSERT INTO profile_catalog_items (id,publisherId,legacyConvexId,kind,slug,displayName,summary,icon,sourceHref,ownerHandle,isOfficial,downloads,stars,sourceGitHubId,sourceRepo,sourcePath,sourceVerifiedCommit,legacyUpdatedAt,sourceHash,lastSeenBatchId,visibleAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE publisherId=VALUES(publisherId),kind=VALUES(kind),slug=VALUES(slug),displayName=VALUES(displayName),summary=VALUES(summary),icon=VALUES(icon),sourceHref=VALUES(sourceHref),ownerHandle=VALUES(ownerHandle),isOfficial=VALUES(isOfficial),downloads=VALUES(downloads),stars=VALUES(stars),sourceGitHubId=VALUES(sourceGitHubId),sourceRepo=VALUES(sourceRepo),sourcePath=VALUES(sourcePath),sourceVerifiedCommit=VALUES(sourceVerifiedCommit),legacyUpdatedAt=VALUES(legacyUpdatedAt),sourceHash=VALUES(sourceHash),lastSeenBatchId=VALUES(lastSeenBatchId),sourceMissingAt=NULL,visibleAt=VALUES(visibleAt),syncedAt=CURRENT_TIMESTAMP(3)`,
    [id,publisherId,snapshot.item.legacyConvexId,snapshot.item.kind,snapshot.item.slug ?? null,snapshot.item.displayName,snapshot.item.summary ?? null,snapshot.item.icon ?? null,snapshot.item.href,snapshot.publisherHandle,snapshot.item.isOfficial,snapshot.item.canonicalStats.downloads,snapshot.item.canonicalStats.stars,snapshot.item.sourceGitHubId ?? null,snapshot.item.sourceRepo ?? null,snapshot.item.sourcePath ?? null,snapshot.item.sourceVerifiedCommit ?? null,new Date(snapshot.item.updatedAt),sourceHash,batchId],
  );
  await migrationFor(executor).ensureLegacyIdMap({ domain: 'profile_catalog_items', legacyConvexId: snapshot.item.legacyConvexId, targetId: id });
  return existing?.sourceHash === sourceHash ? 'unchanged' : 'upserted';
};

const upsertStar = async (executor: SqlExecutor, batchId: string, snapshot: ProfileProjectionStarredSourceSnapshot) => {
  const viewerProfileId = await resolveMap(executor, 'profiles', snapshot.viewerUserLegacyConvexId);
  const sourceHash = hash(snapshot);
  const [existing] = rows<Row>(await executor.query(`SELECT id AS targetId, sourceHash FROM profile_starred_items WHERE viewerUserLegacyConvexId = ? AND skillLegacyConvexId = ? LIMIT 1`, [snapshot.viewerUserLegacyConvexId, snapshot.item.legacyConvexId]));
  const id = existing?.targetId ?? randomUUID();
  if (existing?.sourceHash === sourceHash) {
    await executor.query('UPDATE profile_starred_items SET lastSeenBatchId = ?, sourceMissingAt = NULL WHERE id = ?', [batchId, id]);
    return 'unchanged';
  }
  await executor.query(
    `INSERT INTO profile_starred_items (id,viewerProfileId,viewerUserLegacyConvexId,skillLegacyConvexId,ownerHandle,displayName,summary,icon,sourceHref,isOfficial,downloads,stars,starredAt,skillUpdatedAt,sourceHash,lastSeenBatchId,visibleAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE viewerProfileId=VALUES(viewerProfileId),ownerHandle=VALUES(ownerHandle),displayName=VALUES(displayName),summary=VALUES(summary),icon=VALUES(icon),sourceHref=VALUES(sourceHref),isOfficial=VALUES(isOfficial),downloads=VALUES(downloads),stars=VALUES(stars),starredAt=VALUES(starredAt),skillUpdatedAt=VALUES(skillUpdatedAt),sourceHash=VALUES(sourceHash),lastSeenBatchId=VALUES(lastSeenBatchId),sourceMissingAt=NULL,visibleAt=VALUES(visibleAt),syncedAt=CURRENT_TIMESTAMP(3)`,
    [id,viewerProfileId,snapshot.viewerUserLegacyConvexId,snapshot.item.legacyConvexId,snapshot.item.href.split('/')[1] ?? '',snapshot.item.displayName,snapshot.item.summary ?? null,snapshot.item.icon ?? null,snapshot.item.href,snapshot.item.isOfficial,snapshot.item.canonicalStats.downloads,snapshot.item.canonicalStats.stars,new Date(snapshot.starredAt),new Date(snapshot.item.updatedAt),sourceHash,batchId],
  );
  return existing?.sourceHash === sourceHash ? 'unchanged' : 'upserted';
};

const syncManifest = async (executor: SqlExecutor, batchId: string, manifest: Awaited<ReturnType<ProfileProjectionMigrationSource['listManifests']>>['items'][number]) => {
  const publisherId = await resolveMap(executor, 'publishers', manifest.publisherLegacyConvexId);
  const [existing] = rows<Row>(await executor.query(`SELECT id AS targetId, sourceHash FROM profile_catalog_manifests WHERE sourceGitHubLegacyConvexId = ? LIMIT 1`, [manifest.sourceGitHubLegacyConvexId]));
  const id = existing?.targetId ?? randomUUID(); const sourceHash = hash(manifest);
  if (existing?.sourceHash === sourceHash) {
    await executor.query('UPDATE profile_catalog_manifests SET lastSeenBatchId = ?, sourceMissingAt = NULL WHERE id = ?', [batchId, id]);
    return 'unchanged';
  }
  await executor.query(`INSERT INTO profile_catalog_manifests (id,publisherId,sourceGitHubLegacyConvexId,repo,status,verifiedCommit,notGrouped,legacyUpdatedAt,sourceHash,lastSeenBatchId) VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE publisherId=VALUES(publisherId),repo=VALUES(repo),status=VALUES(status),verifiedCommit=VALUES(verifiedCommit),notGrouped=VALUES(notGrouped),legacyUpdatedAt=VALUES(legacyUpdatedAt),sourceHash=VALUES(sourceHash),lastSeenBatchId=VALUES(lastSeenBatchId),sourceMissingAt=NULL`, [id,publisherId,manifest.sourceGitHubLegacyConvexId,manifest.repo,manifest.status,manifest.verifiedCommit,manifest.notGrouped,new Date(manifest.updatedAt),sourceHash,batchId]);
  for (const section of manifest.sections) {
    const sectionId = randomUUID();
    await executor.query(`INSERT INTO profile_catalog_manifest_sections (id,manifestId,publisherId,position,title,description) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title),description=VALUES(description)`, [sectionId,id,publisherId,section.position,section.title,section.description]);
    for (const entry of section.entries) {
      const items = rows<Row>(await executor.query(`SELECT id AS targetId,publisherId FROM profile_catalog_items WHERE publisherId = ? AND sourceGitHubId = ? AND kind = 'skill' AND (slug = ? OR displayName = ?) LIMIT 2`, [publisherId,manifest.sourceGitHubLegacyConvexId,entry.skillKey,entry.skillKey]));
      if (items.length !== 1) {
        throw new Error(`Manifest entry must resolve to exactly one same-Publisher catalog item: ${entry.skillKey}`);
      }
      const [item] = items;
      if (item.publisherId !== publisherId) throw new Error(`Manifest entry resolves across Publisher boundary: ${entry.skillKey}`);
      await executor.query(`INSERT INTO profile_catalog_manifest_entries (id,sectionId,publisherId,catalogItemId,position,manifestSkillKey) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE catalogItemId=VALUES(catalogItemId),manifestSkillKey=VALUES(manifestSkillKey)`, [randomUUID(),sectionId,publisherId,item.targetId,entry.position,entry.skillKey]);
    }
  }
  return existing?.sourceHash === sourceHash ? 'unchanged' : 'upserted';
};

export const runProfileProjectionSyncPage = async (input: ProfileProjectionSyncInput) => {
  if (!Number.isSafeInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > 250) throw new Error('Profile projection sync batch size must be an integer between 1 and 250');
  const batchId = required(input.batchId, 'batch ID');
  const migration = migrationFor(input.pool); await migration.startBatch({ id: batchId, domain: 'profile_projections', source: 'convex-profile-projection-snapshot', approvalRef: input.approvalRef, requestedBy: input.requestedBy });
  const state = await migration.loadBatchState(batchId); if (state?.status === 'completed') return { batchId, phase: decodeCursor(state.cursor)?.phase ?? 'manifests', upserted: 0, unchanged: 0, done: true };
  const cursor = decodeCursor(state?.cursor ?? null) ?? { version: 1 as const, phase: input.phase ?? 'catalog', sourceCursor: null };
  const page = cursor.phase === 'catalog' ? await input.source.listCatalogItems({ cursor: cursor.sourceCursor, limit: input.batchSize }) : cursor.phase === 'packages' ? await input.source.listPackageItems({ cursor: cursor.sourceCursor, limit: input.batchSize }) : cursor.phase === 'starred' ? await input.source.listStarredItems({ cursor: cursor.sourceCursor, limit: input.batchSize }) : await input.source.listManifests({ cursor: cursor.sourceCursor, limit: input.batchSize });
  const connection = await input.pool.getConnection(); let upserted = 0; let unchanged = 0;
  try { await connection.beginTransaction(); for (const item of page.items) { const outcome = cursor.phase === 'catalog' || cursor.phase === 'packages' ? await upsertCatalog(connection,batchId,item as ProfileProjectionCatalogSourceSnapshot) : cursor.phase === 'starred' ? await upsertStar(connection,batchId,item as ProfileProjectionStarredSourceSnapshot) : await syncManifest(connection,batchId,item as never); if (outcome === 'upserted') upserted++; else unchanged++; }
    const followingCursor = nextCursor(cursor, page);
    await migrationFor(connection).persistProgress(batchId,{ cursor: followingCursor === null ? null : encodeCursor(followingCursor),upsertedCount:BigInt(upserted),unchangedCount:BigInt(unchanged),errorCount:0n,completed:followingCursor===null });
    await migrationFor(connection).publishDomainEvent({ domain:'profile_projections',aggregateId:batchId,aggregateVersion:BigInt(Date.now()),eventType:'profile-projections.page-synced',idempotencyKey:`profile-projections:${batchId}:${cursor.phase}:${cursor.sourceCursor ?? 'initial'}`,payload:{phase:cursor.phase,upserted,unchanged} }); await connection.commit(); return { batchId, phase: cursor.phase, upserted, unchanged, done: followingCursor === null };
  } catch (error) { await connection.rollback(); await migrationFor(input.pool).recordFailure(batchId,'profile_projection_sync_failed'); throw error; } finally { connection.release(); }
};

export const runProfileProjectionSyncToCompletion = async (
  input: ProfileProjectionSyncInput,
): Promise<Readonly<{ batchId: string; upserted: number; unchanged: number; done: true }>> => {
  let upserted = 0;
  let unchanged = 0;
  while (true) {
    const result = await runProfileProjectionSyncPage(input);
    upserted += result.upserted;
    unchanged += result.unchanged;
    if (result.done) return { batchId: result.batchId, upserted, unchanged, done: true };
  }
};