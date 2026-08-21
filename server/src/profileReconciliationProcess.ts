import { createHash, randomUUID } from 'node:crypto';
import { makeFunctionReference } from 'convex/server';
import { createPool, type Pool, type PoolConnection, type RowDataPacket } from 'mysql2/promise';
import { createMigrationPort } from './domains/migration/migrationPort.js';
import { createCandidateFixtureRetentionRepository } from './domains/migration/candidateFixtureRetention.js';
import {
  createConvexProfileAvatarSourceReader,
  type ProfileAvatarSourceReader,
} from './domains/profiles/convexProfileAvatarSourceReader.js';
import {
  reconcileProfileSnapshots,
  type ProfileReconciliationSnapshot,
} from './domains/profiles/profileReconciliation.js';
import {
  reconcileProfilePage,
  runProfileReconciliationPages,
} from './domains/profiles/profileReconciliationRunner.js';
import { createProfileReconciliationCheckpointRepository } from './domains/profiles/profileReconciliationCheckpointRepository.js';
import { createProfileReconciliationReportRepository } from './domains/profiles/profileReconciliationReportRepository.js';
import {
  authorizeAndPreflightProfileProcess,
  boundedProfileInteger,
  installProfileProcessShutdown,
  profileProcessMode,
  requireMysqlDatabaseUrl,
  sleep,
} from './domains/profiles/profileMigrationRuntime.js';
import { createAuthorizedProfileConvexClient } from './profileBackfillProcess.js';

type SourcePage = Readonly<{
  items: readonly ProfileReconciliationSnapshot[];
  cursor: string | null;
  done: boolean;
  watermark: number;
}>;

type ProfileRow = RowDataPacket & {
  legacyConvexId: string;
  handle: string | null;
  profileSlug: string | null;
  personalPublisherLegacyConvexId: string | null;
  deletedAt: Date | string | null;
  deactivatedAt: Date | string | null;
  purgedAt: Date | string | null;
  banReason: string | null;
  imageStorageId: string | null;
};

type LegacyIdRow = RowDataPacket & { legacyConvexId: string };
type AliasRow = RowDataPacket & {
  aliasKind: 'profile_slug' | 'user_handle';
  aliasValue: string;
  isCanonical: boolean | number;
  retiredAt: Date | string | null;
};
type AvatarRow = RowDataPacket & {
  legacyStorageId: string;
  mimeType: string;
  sizeBytes: number | bigint;
  sha256: string;
  status: string;
};

const snapshotPageReference = makeFunctionReference<
  'query',
  { cursor?: string; limit?: number; updatedAfter: number; updatedBefore?: number },
  SourcePage
>('profileMigration:listProfileIncrementalPageInternal');

const timestamp = (value: Date | string | null): number | null =>
  value === null ? null : new Date(value).getTime();

const toSnapshot = (row: ProfileRow): ProfileReconciliationSnapshot => ({
  legacyConvexId: row.legacyConvexId,
  handle: row.handle,
  profileSlug: row.profileSlug,
  personalPublisherLegacyConvexId: row.personalPublisherLegacyConvexId,
  deletedAt: timestamp(row.deletedAt),
  deactivatedAt: timestamp(row.deactivatedAt),
  purgedAt: timestamp(row.purgedAt),
  banReason: row.banReason,
  imageStorageId: row.imageStorageId,
});

const createPagedSource = (
  queryPage: (args: {
    cursor?: string;
    limit?: number;
    updatedAfter: number;
    updatedBefore?: number;
  }) => Promise<SourcePage>,
  avatarReader: ProfileAvatarSourceReader,
  pageSize: number,
  windowStart: number,
) => Object.freeze({
  readPage: async (input: Readonly<{ cursor: string | null; watermark: number | null }>) => {
    const page = await queryPage({
      cursor: input.cursor ?? undefined,
      limit: pageSize,
      updatedAfter: windowStart,
      updatedBefore: input.watermark ?? undefined,
    });
    return {
      profiles: page.items,
      nextCursor: page.cursor,
      done: page.done,
      watermark: page.watermark,
    };
  },
  avatarMetadata: async (storageId: string) => {
    const source = await avatarReader.read(storageId);
    if (!source) return null;
    const hash = createHash('sha256');
    let sizeBytes = 0;
    for await (const rawChunk of source.stream) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      sizeBytes += chunk.length;
      hash.update(chunk);
    }
    return {
      mimeType: source.declaredMimeType,
      sizeBytes,
      sha256: hash.digest('hex'),
    };
  },
});

const createTarget = (pool: Pool | PoolConnection) => Object.freeze({
  findProfile: async (legacyConvexId: string) => {
    const [rows] = await pool.query<ProfileRow[]>(
      `SELECT legacyConvexId, handle, profileSlug, personalPublisherLegacyConvexId,
              deletedAt, deactivatedAt, purgedAt, banReason, imageStorageId
       FROM profile_snapshots
       WHERE legacyConvexId = ?
       LIMIT 1`,
      [legacyConvexId],
    );
    return rows[0] ? toSnapshot(rows[0]) : null;
  },
  listLegacyConvexIds: async () => {
    const [rows] = await pool.query<LegacyIdRow[]>(
      'SELECT legacyConvexId FROM profile_snapshots ORDER BY legacyConvexId ASC',
    );
    return rows.map((row) => row.legacyConvexId);
  },
  listAliases: async (legacyConvexId: string) => {
    const [rows] = await pool.query<AliasRow[]>(
      `SELECT alias.aliasKind, alias.aliasValue, alias.isCanonical,
              alias.retiredAt
       FROM profile_identity_aliases alias
       INNER JOIN profile_snapshots profile ON profile.id = alias.profileId
       WHERE profile.legacyConvexId = ?`,
      [legacyConvexId],
    );
    return rows.map((row) => ({
      aliasKind: row.aliasKind,
      aliasValue: row.aliasValue,
      isCanonical: Boolean(row.isCanonical),
      retiredAt: timestamp(row.retiredAt),
    }));
  },
  findAvatar: async (legacyConvexId: string) => {
    const [rows] = await pool.query<AvatarRow[]>(
      `SELECT asset.legacyStorageId, asset.mimeType, asset.sizeBytes, asset.sha256, asset.status
       FROM profile_snapshots profile
       INNER JOIN profile_asset_snapshots snapshot ON snapshot.profileId = profile.id
       INNER JOIN convex_exit_managed_assets asset ON asset.id = snapshot.targetAssetId
       WHERE profile.legacyConvexId = ?
       LIMIT 1`,
      [legacyConvexId],
    );
    const row = rows[0];
    return row
      ? {
          legacyStorageId: row.legacyStorageId,
          mimeType: row.mimeType,
          sizeBytes: Number(row.sizeBytes),
          sha256: row.sha256,
          status: row.status === 'deleted' ? 'deleted' as const : 'active' as const,
        }
      : null;
  },
});

export const runProfileReconciliationProcess = async (
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> => {
  const databaseUrl = requireMysqlDatabaseUrl(environment);
  const mode = profileProcessMode(environment.PROFILE_PROCESS_MODE);
  const configuredBatchId = environment.PROFILE_RECONCILIATION_BATCH_ID?.trim() || null;
  if (mode === 'loop' && configuredBatchId) {
    throw new Error('PROFILE_RECONCILIATION_BATCH_ID cannot be reused in loop mode');
  }
  const pageSize = boundedProfileInteger(
    environment.PROFILE_RECONCILIATION_PAGE_SIZE,
    'PROFILE_RECONCILIATION_PAGE_SIZE',
    100,
    1,
    250,
  );
  const intervalMs = boundedProfileInteger(
    environment.PROFILE_RECONCILIATION_INTERVAL_MS,
    'PROFILE_RECONCILIATION_INTERVAL_MS',
    300_000,
    1_000,
    3_600_000,
  );
  const windowStart = boundedProfileInteger(
    environment.PROFILE_RECONCILIATION_UPDATED_AFTER,
    'PROFILE_RECONCILIATION_UPDATED_AFTER',
    0,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const pool = createPool({ uri: databaseUrl, connectionLimit: 4, waitForConnections: true });
  const shutdown = installProfileProcessShutdown();

  try {
    const { authorization } = await authorizeAndPreflightProfileProcess(pool, environment);
    const convex = createAuthorizedProfileConvexClient(environment);
    const avatarReader = createConvexProfileAvatarSourceReader({
      query: (reference, args) => convex.query(reference, args),
    });
    const target = createTarget(pool);
    do {
      const batchId = configuredBatchId || randomUUID();
      const migration = createMigrationPort({
        query: (sql, values) => pool.query(sql, values ? [...values] : undefined),
      });
      await migration.startBatch({
        id: batchId,
        domain: 'profiles',
        source: 'convex-users-reconciliation',
        approvalRef: authorization.approvalRef,
        requestedBy: environment.PROFILE_MIGRATION_REQUESTED_BY?.trim() || undefined,
      });
      const batchState = await migration.loadBatchState(batchId);
      if (batchState?.status === 'completed') {
        throw new Error('Completed Profile reconciliation batch cannot be reopened');
      }
      try {
        const checkpointRepository = createProfileReconciliationCheckpointRepository({
          query: (sql, values) => pool.query(sql, values ? [...values] : undefined),
        });
        const checkpoint = await checkpointRepository.load(batchId);
        const batchWindowStart = checkpoint
          ? Number(checkpoint.sourceRange.replace('users.updated_at:', ''))
          : windowStart;
        if (!Number.isSafeInteger(batchWindowStart) || batchWindowStart < 0) {
          throw new Error('Profile reconciliation checkpoint has an invalid source range');
        }
        const batchSource = createPagedSource(
          (args) => convex.query(snapshotPageReference, args),
          avatarReader,
          pageSize,
          batchWindowStart,
        );

        await runProfileReconciliationPages({
          checkpoint: checkpoint && {
            sourceCursor: checkpoint.sourceCursor,
            sourceWatermark: checkpoint.sourceWatermark,
            sourceProfiles: checkpoint.sourceCount,
            comparedProfiles: checkpoint.comparedCount,
            differences: checkpoint.differenceCount,
            sourceExhausted: checkpoint.sourceExhausted,
            completed: checkpoint.completed,
          },
          source: batchSource,
          commitPage: async (page) => {
            const connection = await pool.getConnection();
            try {
              await connection.beginTransaction();
              const pageMigration = createMigrationPort({
                query: (sql, values) => connection.query(sql, values ? [...values] : undefined),
              });
              const pageCheckpoint = createProfileReconciliationCheckpointRepository({
                query: (sql, values) => connection.query(sql, values ? [...values] : undefined),
              });
              const pageSummary = await reconcileProfilePage({
                batchId,
                profiles: page.profiles,
                source: batchSource,
                target: createTarget(connection),
                sink: {
                  record: (difference) => pageMigration.recordDifference({ domain: 'profiles', ...difference }),
                },
              });
              await pageCheckpoint.start({
                batchId,
                sourceWatermark: page.watermark,
                sourceRange: `users.updated_at:${batchWindowStart}`,
              });
              await pageCheckpoint.recordSourceIds(batchId, [...pageSummary.sourceIds]);
              await pageCheckpoint.advance({
                batchId,
                sourceCursor: page.nextCursor,
                sourceCount: pageSummary.sourceProfiles,
                comparedCount: pageSummary.comparedProfiles,
                differenceCount: pageSummary.differences,
                sourceExhausted: page.done,
              });
              await pageMigration.persistProgress(batchId, {
                cursor: page.nextCursor,
                sourceCount: BigInt(pageSummary.sourceProfiles),
                upsertedCount: 0n,
                unchangedCount: BigInt(pageSummary.comparedProfiles),
                errorCount: 0n,
                completed: false,
              });
              await connection.commit();
            } catch (error) {
              await connection.rollback();
              throw error;
            } finally {
              connection.release();
            }
          },
          finalize: async () => {
            const connection = await pool.getConnection();
            try {
              await connection.beginTransaction();
              const finalMigration = createMigrationPort({
                query: (sql, values) => connection.query(sql, values ? [...values] : undefined),
              });
              const finalCheckpoint = createProfileReconciliationCheckpointRepository({
                query: (sql, values) => connection.query(sql, values ? [...values] : undefined),
              });
              const retention = createCandidateFixtureRetentionRepository({
                query: (sql, values) => connection.query(sql, values ? [...values] : undefined),
              });
              const [orphanRows] = await connection.query<LegacyIdRow[]>(
                `SELECT target.legacyConvexId
                 FROM profile_snapshots target
                 LEFT JOIN profile_reconciliation_source_ids source
                   ON source.batchId = ? AND source.legacyConvexId = target.legacyConvexId
                 WHERE source.legacyConvexId IS NULL
                 ORDER BY target.legacyConvexId ASC`,
                [batchId],
              );
              for (const orphan of orphanRows) {
                const [difference] = reconcileProfileSnapshots(null, {
                  legacyConvexId: orphan.legacyConvexId,
                  handle: null,
                  profileSlug: null,
                  personalPublisherLegacyConvexId: null,
                  deletedAt: null,
                  deactivatedAt: null,
                  purgedAt: null,
                  banReason: null,
                  imageStorageId: null,
                });
                if (difference) {
                  const retained = await retention.classifyTargetOnly({ domain: 'profiles', ...difference });
                  await finalMigration.recordDifference({
                    domain: 'profiles',
                    batchId,
                    classification: retained ? 'expected_retired_fixture' : 'unclassified',
                    ...difference,
                  });
                }
              }
              await finalCheckpoint.complete(batchId, orphanRows.length);
              const completed = await finalCheckpoint.load(batchId);
              await finalMigration.persistProgress(batchId, {
                cursor: null,
                sourceCount: BigInt(completed?.sourceCount ?? 0),
                upsertedCount: 0n,
                unchangedCount: BigInt(completed?.comparedCount ?? 0),
                errorCount: 0n,
                completed: true,
              });
              await connection.commit();
            } catch (error) {
              await connection.rollback();
              throw error;
            } finally {
              connection.release();
            }
          },
        });

        const completedCheckpoint = await checkpointRepository.load(batchId);
        const targetProfiles = await target.listLegacyConvexIds();
        const report = await createProfileReconciliationReportRepository({
          query: (sql, values) => pool.query(sql, values ? [...values] : undefined),
        }).persist({
          batchId,
          sourceProfiles: completedCheckpoint?.sourceCount ?? 0,
          targetProfiles: targetProfiles.length,
          comparedProfiles: completedCheckpoint?.comparedCount ?? 0,
          differences: completedCheckpoint?.differenceCount ?? 0,
          unclassifiedDifferences: completedCheckpoint?.differenceCount ?? 0,
          candidateReady: false,
        }, completedCheckpoint);
        console.info(JSON.stringify({
          event: 'profile.reconciliation.completed',
          environment: authorization.environment,
          approvalRef: authorization.approvalRef,
          ...report,
        }));
      } catch (error) {
        const failureCode = error instanceof Error ? error.message.slice(0, 128) : 'profile_reconciliation_failed';
        await createProfileReconciliationCheckpointRepository({
          query: (sql, values) => pool.query(sql, values ? [...values] : undefined),
        }).fail(batchId, failureCode);
        await migration.recordFailure(batchId, failureCode);
        throw error;
      }
      if (mode === 'once' || shutdown.isStopping()) break;
      await sleep(intervalMs);
    } while (!shutdown.isStopping());
  } finally {
    shutdown.dispose();
    await pool.end();
  }
};

if (process.argv[1] && /(?:^|\/)profileReconciliationProcess(?:\.ts|\.js)?$/.test(process.argv[1])) {
  await runProfileReconciliationProcess();
}
