import { createHash, randomUUID } from 'node:crypto';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise';

type ProfileSnapshot = {
  legacyConvexId: string;
  legacyCreationTime: number;
  name: string | null;
  handle: string | null;
  profileSlug: string | null;
  displayName: string | null;
  bio: string | null;
  image: string | null;
  imageStorageId: string | null;
  developerStatus: string | null;
  developerAppliedAt: number | null;
  developerApprovedAt: number | null;
  role: string | null;
  trustedPublisher: boolean;
  publishedSkills: number;
  totalStars: number;
  totalDownloads: number;
  personalPublisherLegacyConvexId: string | null;
  deletedAt: number | null;
  deactivatedAt: number | null;
  purgedAt: number | null;
  banReason: string | null;
  legacyCreatedAt: number | null;
  legacyUpdatedAt: number | null;
};

type SnapshotPage = { items: ProfileSnapshot[]; cursor: string | null; done: boolean };
type CursorRow = RowDataPacket & { cursorValue: string | null; isComplete: number | boolean };
type CountRow = RowDataPacket & { count: number };

const snapshotPageReference = makeFunctionReference<
  'query',
  { cursor?: string; limit?: number },
  SnapshotPage
>('profileMigration:listProfileSnapshotPageInternal');

const required = (value: string | undefined, name: string): string => {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value;
};

const boundedBatchSize = (value: string | undefined): number => {
  const parsed = Number(value ?? 100);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 250) {
    throw new Error('PROFILE_BACKFILL_BATCH_SIZE must be an integer between 1 and 250');
  }
  return parsed;
};

const isoDate = (milliseconds: number | null): Date | null =>
  milliseconds === null ? null : new Date(milliseconds);

const stableHash = (snapshot: ProfileSnapshot): string =>
  createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');

const loadCursor = async (pool: Pool, batchId: string): Promise<{ value: string | null; done: boolean }> => {
  const [rows] = await pool.query<CursorRow[]>(
    `SELECT cursorValue, isComplete
     FROM profile_migration_cursors
     WHERE batchId = ? AND cursorName = 'convex-users'
     LIMIT 1`,
    [batchId],
  );
  const row = rows[0];
  return { value: row?.cursorValue ?? null, done: Boolean(row?.isComplete) };
};

const ensureBatch = async (pool: Pool, batchId: string): Promise<void> => {
  await pool.query(
    `INSERT INTO profile_migration_batches (id, source, status)
     VALUES (?, 'convex-users', 'running')
     ON DUPLICATE KEY UPDATE status = IF(status = 'completed', status, 'running'), failedAt = NULL, failureCode = NULL`,
    [batchId],
  );
  await pool.query(
    `INSERT INTO profile_migration_cursors (batchId, cursorName, cursorValue, isComplete)
     VALUES (?, 'convex-users', NULL, FALSE)
     ON DUPLICATE KEY UPDATE batchId = batchId`,
    [batchId],
  );
};

const upsertSnapshot = async (pool: Pool, snapshot: ProfileSnapshot): Promise<'upserted' | 'unchanged'> => {
  const sourceHash = stableHash(snapshot);
  const [existing] = await pool.query<Array<RowDataPacket & { sourceHash: string }>>(
    'SELECT sourceHash FROM profile_snapshots WHERE legacyConvexId = ? LIMIT 1',
    [snapshot.legacyConvexId],
  );
  if (existing[0]?.sourceHash === sourceHash) return 'unchanged';

  const id = randomUUID();
  await pool.query(
    `INSERT INTO profile_snapshots (
       id, legacyConvexId, handle, profileSlug, name, displayName, bio, image, imageStorageId,
       developerStatus, developerAppliedAt, developerApprovedAt, role, trustedPublisher,
       publishedSkills, totalStars, totalDownloads, personalPublisherLegacyConvexId,
       deletedAt, deactivatedAt, purgedAt, banReason, legacyCreationTime, legacyCreatedAt,
       legacyUpdatedAt, sourceHash, syncedAt
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE
       handle = VALUES(handle), profileSlug = VALUES(profileSlug), name = VALUES(name),
       displayName = VALUES(displayName), bio = VALUES(bio), image = VALUES(image),
       imageStorageId = VALUES(imageStorageId), developerStatus = VALUES(developerStatus),
       developerAppliedAt = VALUES(developerAppliedAt), developerApprovedAt = VALUES(developerApprovedAt),
       role = VALUES(role), trustedPublisher = VALUES(trustedPublisher),
       publishedSkills = VALUES(publishedSkills), totalStars = VALUES(totalStars),
       totalDownloads = VALUES(totalDownloads),
       personalPublisherLegacyConvexId = VALUES(personalPublisherLegacyConvexId),
       deletedAt = VALUES(deletedAt), deactivatedAt = VALUES(deactivatedAt), purgedAt = VALUES(purgedAt),
       banReason = VALUES(banReason), legacyCreationTime = VALUES(legacyCreationTime),
       legacyCreatedAt = VALUES(legacyCreatedAt), legacyUpdatedAt = VALUES(legacyUpdatedAt),
       sourceHash = VALUES(sourceHash), syncedAt = CURRENT_TIMESTAMP(3)`,
    [
      id,
      snapshot.legacyConvexId,
      snapshot.handle,
      snapshot.profileSlug,
      snapshot.name,
      snapshot.displayName,
      snapshot.bio,
      snapshot.image,
      snapshot.imageStorageId,
      snapshot.developerStatus,
      isoDate(snapshot.developerAppliedAt),
      isoDate(snapshot.developerApprovedAt),
      snapshot.role,
      snapshot.trustedPublisher,
      snapshot.publishedSkills,
      snapshot.totalStars,
      snapshot.totalDownloads,
      snapshot.personalPublisherLegacyConvexId,
      isoDate(snapshot.deletedAt),
      isoDate(snapshot.deactivatedAt),
      isoDate(snapshot.purgedAt),
      snapshot.banReason,
      snapshot.legacyCreationTime,
      isoDate(snapshot.legacyCreatedAt),
      isoDate(snapshot.legacyUpdatedAt),
      sourceHash,
    ],
  );
  const [snapshotRows] = await pool.query<Array<RowDataPacket & { id: string }>>(
    'SELECT id FROM profile_snapshots WHERE legacyConvexId = ? LIMIT 1',
    [snapshot.legacyConvexId],
  );
  const mysqlProfileId = snapshotRows[0]?.id;
  if (!mysqlProfileId) throw new Error('Profile snapshot was not persisted');
  await pool.query(
    `INSERT INTO profile_legacy_id_maps (legacyConvexId, mysqlProfileId)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE mysqlProfileId = VALUES(mysqlProfileId)`,
    [snapshot.legacyConvexId, mysqlProfileId],
  );
  return 'upserted';
};

const persistProgress = async (
  pool: Pool,
  batchId: string,
  cursor: string | null,
  done: boolean,
  counts: { upserted: number; unchanged: number },
): Promise<void> => {
  await pool.query(
    `UPDATE profile_migration_cursors
     SET cursorValue = ?, isComplete = ?
     WHERE batchId = ? AND cursorName = 'convex-users'`,
    [cursor, done, batchId],
  );
  await pool.query(
    `UPDATE profile_migration_batches
     SET upsertedCount = upsertedCount + ?, unchangedCount = unchangedCount + ?,
       status = IF(?, 'completed', 'running'), completedAt = IF(?, CURRENT_TIMESTAMP(3), NULL)
     WHERE id = ?`,
    [counts.upserted, counts.unchanged, done, done, batchId],
  );
};

const recordFailure = (pool: Pool, batchId: string): Promise<unknown> =>
  pool.query(
    `UPDATE profile_migration_batches
     SET status = 'failed', failedAt = CURRENT_TIMESTAMP(3), failureCode = 'profile_backfill_failed', errorCount = errorCount + 1
     WHERE id = ?`,
    [batchId],
  );

export const runProfileBackfill = async (
  input: Readonly<{ pool: Pool; convex: Pick<ConvexHttpClient, 'query'>; batchId: string; batchSize: number }>,
): Promise<{ batchId: string; upserted: number; unchanged: number; done: boolean }> => {
  await ensureBatch(input.pool, input.batchId);
  const cursor = await loadCursor(input.pool, input.batchId);
  if (cursor.done) return { batchId: input.batchId, upserted: 0, unchanged: 0, done: true };
  try {
    const page = await input.convex.query(snapshotPageReference, {
      cursor: cursor.value ?? undefined,
      limit: input.batchSize,
    });
    let upserted = 0;
    let unchanged = 0;
    for (const snapshot of page.items) {
      const outcome = await upsertSnapshot(input.pool, snapshot);
      if (outcome === 'upserted') upserted += 1;
      else unchanged += 1;
    }
    await persistProgress(input.pool, input.batchId, page.cursor, page.done, { upserted, unchanged });
    return { batchId: input.batchId, upserted, unchanged, done: page.done };
  } catch (error) {
    await recordFailure(input.pool, input.batchId);
    throw error;
  }
};

export const runProfileBackfillToCompletion = async (
  input: Readonly<{
    pool: Pool;
    convex: Pick<ConvexHttpClient, 'query'>;
    batchId: string;
    batchSize: number;
  }>,
): Promise<{ batchId: string; upserted: number; unchanged: number; done: true }> => {
  let upserted = 0;
  let unchanged = 0;
  while (true) {
    const result = await runProfileBackfill(input);
    upserted += result.upserted;
    unchanged += result.unchanged;
    if (result.done) return { batchId: input.batchId, upserted, unchanged, done: true };
  }
};

const main = async (): Promise<void> => {
  const databaseUrl = required(process.env.DATABASE_URL, 'DATABASE_URL');
  const convexUrl = required(process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL, 'CONVEX_URL');
  const batchId = process.env.PROFILE_BACKFILL_BATCH_ID?.trim() || randomUUID();
  const pool = createPool({ uri: databaseUrl, connectionLimit: 1, waitForConnections: true });
  try {
    const result = await runProfileBackfillToCompletion({
      pool,
      convex: new ConvexHttpClient(convexUrl),
      batchId,
      batchSize: boundedBatchSize(process.env.PROFILE_BACKFILL_BATCH_SIZE),
    });
    console.info(JSON.stringify({ event: 'profile.backfill.completed', ...result }));
  } finally {
    await pool.end();
  }
};

if (process.argv[1] && /(?:^|\/)profileBackfillProcess(?:\.ts|\.js)?$/.test(process.argv[1])) {
  await main();
}