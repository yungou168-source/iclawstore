import { createHash, randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";
import { createMigrationPort } from "./domains/migration/migrationPort.js";
import {
  decodeProfileIncrementalCursor,
  encodeProfileIncrementalCursor,
  profileIncrementalWindowStart,
} from "./domains/profiles/profileIncrementalCursor.js";
import { authorizeAndPreflightProfileProcess } from "./domains/profiles/profileMigrationRuntime.js";

type ProfileIdentityAliasSnapshot = {
  aliasKind: "profile_slug" | "user_handle";
  aliasValue: string;
  isCanonical: boolean;
  retiredAt: number | null;
};

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
  aliases?: ProfileIdentityAliasSnapshot[];
};

type SqlExecutor = Pick<Pool, "query">;

type SnapshotPage = { items: ProfileSnapshot[]; cursor: string | null; done: boolean };
type IncrementalSnapshotPage = SnapshotPage & { watermark: number };
type SnapshotRow = RowDataPacket & { id: string; sourceHash: string };
type AliasRow = RowDataPacket & { profileId: string };
type ProfileSyncBatchInput = {
  pool: Pool;
  convex: Pick<ConvexHttpClient, "query">;
  batchId: string;
  batchSize: number;
  approvalRef?: string;
  requestedBy?: string;
};

const snapshotPageReference = makeFunctionReference<
  "query",
  { cursor?: string; limit?: number },
  SnapshotPage
>("profileMigration:listProfileSnapshotPageInternal");

const incrementalSnapshotPageReference = makeFunctionReference<
  "query",
  { cursor?: string; limit?: number; updatedAfter: number; updatedBefore?: number },
  IncrementalSnapshotPage
>("profileMigration:listProfileIncrementalPageInternal");

const required = (value: string | undefined, name: string): string => {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value;
};

export const createAuthorizedProfileConvexClient = (
  environment: NodeJS.ProcessEnv = process.env,
): ConvexHttpClient => {
  const convexUrl = required(environment.CONVEX_URL ?? environment.VITE_CONVEX_URL, "CONVEX_URL");
  const adminKey = required(
    environment.PROFILE_MIGRATION_CONVEX_ADMIN_KEY ?? environment.CONVEX_SELF_HOSTED_ADMIN_KEY,
    "PROFILE_MIGRATION_CONVEX_ADMIN_KEY",
  );
  const client = new ConvexHttpClient(convexUrl);
  const adminClient = client as ConvexHttpClient & { setAdminAuth(token: string): void };
  adminClient.setAdminAuth(adminKey);
  return client;
};

const boundedBatchSize = (value: string | undefined): number => {
  const parsed = Number(value ?? 100);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 250) {
    throw new Error("PROFILE_BACKFILL_BATCH_SIZE must be an integer between 1 and 250");
  }
  return parsed;
};

const boundedNonNegativeInteger = (value: string | undefined, name: string): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return parsed;
};

const isoDate = (milliseconds: number | null): Date | null =>
  milliseconds === null ? null : new Date(milliseconds);

const stableHash = (snapshot: ProfileSnapshot): string =>
  createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");

const migrationPortFor = (executor: SqlExecutor) =>
  createMigrationPort({
    query: (sql, values) => executor.query(sql, values ? [...values] : undefined),
  });

const loadBatchState = async (
  pool: SqlExecutor,
  batchId: string,
): Promise<{ value: string | null; done: boolean }> => {
  const state = await migrationPortFor(pool).loadBatchState(batchId);
  return { value: state?.cursor ?? null, done: state?.status === "completed" };
};

const ensureBatch = async (
  pool: SqlExecutor,
  batchId: string,
  approvalRef = "isolated-only",
  requestedBy?: string,
): Promise<void> => {
  await migrationPortFor(pool).startBatch({
    id: batchId,
    domain: "profiles",
    source: "convex-users",
    approvalRef,
    requestedBy,
  });
};

const ensureLegacyIdMap = async (
  pool: SqlExecutor,
  legacyConvexId: string,
  mysqlProfileId: string,
): Promise<void> => {
  await migrationPortFor(pool).ensureLegacyIdMap({
    domain: "profiles",
    legacyConvexId,
    targetId: mysqlProfileId,
  });
};

const syncProfileAliases = async (
  pool: SqlExecutor,
  profileId: string,
  snapshot: ProfileSnapshot,
): Promise<void> => {
  await pool.query(
    `UPDATE profile_identity_aliases
     SET isCanonical = FALSE, retiredAt = COALESCE(retiredAt, CURRENT_TIMESTAMP(3))
     WHERE profileId = ? AND isCanonical = TRUE`,
    [profileId],
  );
  const aliases = snapshot.aliases?.length
    ? snapshot.aliases
    : [
        snapshot.profileSlug
          ? { aliasKind: 'profile_slug' as const, aliasValue: snapshot.profileSlug, isCanonical: true, retiredAt: null }
          : null,
        snapshot.handle
          ? { aliasKind: 'user_handle' as const, aliasValue: snapshot.handle, isCanonical: true, retiredAt: null }
          : null,
      ].filter((alias): alias is NonNullable<typeof alias> => alias !== null);
  for (const alias of aliases) {
    const aliasValue = alias.aliasValue.trim().toLowerCase();
    const [existing] = await pool.query<AliasRow[]>(
      `SELECT profileId FROM profile_identity_aliases
       WHERE aliasKind = ? AND aliasValue = ? LIMIT 1`,
      [alias.aliasKind, aliasValue],
    );
    if (existing[0] && existing[0].profileId !== profileId) {
      throw new Error('Profile identity alias maps to a different profile');
    }
    await pool.query(
      `INSERT INTO profile_identity_aliases
         (id, profileId, aliasKind, aliasValue, isCanonical, retiredAt)
       VALUES (UUID(), ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         isCanonical = VALUES(isCanonical), retiredAt = VALUES(retiredAt), updatedAt = CURRENT_TIMESTAMP(3)`,
      [profileId, alias.aliasKind, aliasValue, alias.isCanonical, isoDate(alias.retiredAt)],
    );
  }
};

const enqueueProfileAvatar = async (
  pool: SqlExecutor,
  profileId: string,
  snapshot: ProfileSnapshot,
): Promise<void> => {
  const sourceStorageId = snapshot.imageStorageId;
  await pool.query(
    `INSERT INTO profile_asset_snapshots
       (id, profileId, sourceStorageId, sourceUrl, status, deletedAt)
     VALUES (UUID(), ?, ?, ?, IF(? IS NULL, 'not_applicable', 'pending'), ?)
     ON DUPLICATE KEY UPDATE
       sourceUrl = VALUES(sourceUrl),
       deletedAt = VALUES(deletedAt),
       status = CASE
         WHEN VALUES(deletedAt) IS NOT NULL THEN 'deleted'
         WHEN sourceStorageId IS NULL THEN 'not_applicable'
         WHEN sourceStorageId <> VALUES(sourceStorageId) THEN 'pending'
         ELSE status
       END,
       sourceStorageId = VALUES(sourceStorageId)`,
    [profileId, sourceStorageId, snapshot.image, sourceStorageId, isoDate(snapshot.deletedAt)],
  );
  if (!sourceStorageId || snapshot.deletedAt !== null) return;
  const sourceVersion = BigInt(
    Math.max(
      0,
      Math.trunc(
        snapshot.legacyUpdatedAt ?? snapshot.legacyCreatedAt ?? snapshot.legacyCreationTime,
      ),
    ),
  );
  await migrationPortFor(pool).publishDomainEvent({
    domain: "profiles",
    aggregateId: snapshot.legacyConvexId,
    aggregateVersion: sourceVersion,
    eventType: "profiles.avatar.import-requested",
    idempotencyKey: `profile-avatar:${sourceStorageId}:${sourceVersion}`,
    payload: {
      legacyConvexId: snapshot.legacyConvexId,
      sourceStorageId,
      profileId,
    },
  });
};

const upsertSnapshot = async (
  pool: SqlExecutor,
  snapshot: ProfileSnapshot,
): Promise<"upserted" | "unchanged"> => {
  const sourceHash = stableHash(snapshot);
  const [existing] = await pool.query<SnapshotRow[]>(
    "SELECT id, sourceHash FROM profile_snapshots WHERE legacyConvexId = ? LIMIT 1",
    [snapshot.legacyConvexId],
  );
  if (existing[0]?.sourceHash === sourceHash) {
    await ensureLegacyIdMap(pool, snapshot.legacyConvexId, existing[0].id);
    await syncProfileAliases(pool, existing[0].id, snapshot);
    await enqueueProfileAvatar(pool, existing[0].id, snapshot);
    return "unchanged";
  }

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
    "SELECT id FROM profile_snapshots WHERE legacyConvexId = ? LIMIT 1",
    [snapshot.legacyConvexId],
  );
  const mysqlProfileId = snapshotRows[0]?.id;
  if (!mysqlProfileId) throw new Error("Profile snapshot was not persisted");
  await ensureLegacyIdMap(pool, snapshot.legacyConvexId, mysqlProfileId);
  await syncProfileAliases(pool, mysqlProfileId, snapshot);
  await enqueueProfileAvatar(pool, mysqlProfileId, snapshot);
  return "upserted";
};

const persistProgress = async (
  pool: SqlExecutor,
  batchId: string,
  cursor: string | null,
  done: boolean,
  counts: { upserted: number; unchanged: number },
): Promise<void> => {
  await migrationPortFor(pool).persistProgress(batchId, {
    cursor,
    upsertedCount: BigInt(counts.upserted),
    unchangedCount: BigInt(counts.unchanged),
    errorCount: 0n,
    completed: done,
  });
};

const persistIncrementalProgress = async (
  pool: SqlExecutor,
  batchId: string,
  cursor: string | null,
  done: boolean,
  watermark: number,
  windowStart: number,
  counts: { upserted: number; unchanged: number },
): Promise<void> => {
  await persistProgress(pool, batchId, cursor, done, counts);
  await pool.query(
    `INSERT INTO profile_sync_checkpoints
       (id, batchId, watermark, windowStart, cursorAgeMs, retryCount, completedAt)
     VALUES (UUID(), ?, ?, ?, ?, 0, IF(?, CURRENT_TIMESTAMP(3), NULL))
     ON DUPLICATE KEY UPDATE
       watermark = VALUES(watermark), windowStart = VALUES(windowStart),
       cursorAgeMs = VALUES(cursorAgeMs), retryCount = 0, lastFailureCode = NULL,
       completedAt = VALUES(completedAt)`,
    [batchId, watermark, windowStart, Math.max(0, Date.now() - watermark), done],
  );
};

const recordFailure = async (pool: SqlExecutor, batchId: string): Promise<void> => {
  await migrationPortFor(pool).recordFailure(batchId, "profile_backfill_failed");
  await pool.query(
    `UPDATE profile_sync_checkpoints
     SET retryCount = retryCount + 1, lastFailureCode = 'profile_backfill_failed'
     WHERE batchId = ?`,
    [batchId],
  );
};

type TransactionConnection = SqlExecutor &
  Readonly<{
    beginTransaction: () => Promise<void>;
    commit: () => Promise<void>;
    rollback: () => Promise<void>;
    release: () => void;
  }>;

type TransactionalPool = SqlExecutor &
  Readonly<{
    getConnection?: () => Promise<TransactionConnection>;
  }>;

const persistPageAtomically = async (
  pool: TransactionalPool,
  persist: (executor: SqlExecutor) => Promise<void>,
): Promise<void> => {
  if (!pool.getConnection) return persist(pool);
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  try {
    await persist(connection);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const runProfileBackfill = async (
  input: Readonly<ProfileSyncBatchInput>,
): Promise<{ batchId: string; upserted: number; unchanged: number; done: boolean }> => {
  await ensureBatch(input.pool, input.batchId, input.approvalRef, input.requestedBy);
  const cursor = await loadBatchState(input.pool, input.batchId);
  if (cursor.done) return { batchId: input.batchId, upserted: 0, unchanged: 0, done: true };
  try {
    const page = await input.convex.query(snapshotPageReference, {
      cursor: cursor.value ?? undefined,
      limit: input.batchSize,
    });
    let upserted = 0;
    let unchanged = 0;
    await persistPageAtomically(input.pool, async (executor) => {
      for (const snapshot of page.items) {
        const outcome = await upsertSnapshot(executor, snapshot);
        if (outcome === "upserted") upserted += 1;
        else unchanged += 1;
      }
      await persistProgress(executor, input.batchId, page.cursor, page.done, {
        upserted,
        unchanged,
      });
    });
    return { batchId: input.batchId, upserted, unchanged, done: page.done };
  } catch (error) {
    await recordFailure(input.pool, input.batchId);
    throw error;
  }
};

export const runProfileBackfillToCompletion = async (
  input: Readonly<ProfileSyncBatchInput>,
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

export const runProfileIncrementalSync = async (
  input: Readonly<
    ProfileSyncBatchInput & {
      updatedAfter: number;
      overlapMs: number;
    }
  >,
): Promise<{
  batchId: string;
  upserted: number;
  unchanged: number;
  done: boolean;
  watermark: number | null;
}> => {
  await ensureBatch(input.pool, input.batchId, input.approvalRef, input.requestedBy);
  const saved = await loadBatchState(input.pool, input.batchId);
  const persisted = decodeProfileIncrementalCursor(saved.value);
  if (saved.done) {
    return {
      batchId: input.batchId,
      upserted: 0,
      unchanged: 0,
      done: true,
      watermark: persisted?.watermark ?? null,
    };
  }

  try {
    const windowStart =
      persisted?.windowStart ?? profileIncrementalWindowStart(input.updatedAfter, input.overlapMs);
    const page = await input.convex.query(incrementalSnapshotPageReference, {
      cursor: persisted?.cursor ?? undefined,
      limit: input.batchSize,
      updatedAfter: windowStart,
      updatedBefore: persisted?.watermark,
    });
    let upserted = 0;
    let unchanged = 0;
    await persistPageAtomically(input.pool, async (executor) => {
      for (const snapshot of page.items) {
        const outcome = await upsertSnapshot(executor, snapshot);
        if (outcome === "upserted") upserted += 1;
        else unchanged += 1;
      }
      await persistIncrementalProgress(
        executor,
        input.batchId,
        encodeProfileIncrementalCursor({
          cursor: page.cursor,
          watermark: page.watermark,
          windowStart,
        }),
        page.done,
        page.watermark,
        windowStart,
        { upserted, unchanged },
      );
    });
    return {
      batchId: input.batchId,
      upserted,
      unchanged,
      done: page.done,
      watermark: page.watermark,
    };
  } catch (error) {
    await recordFailure(input.pool, input.batchId);
    throw error;
  }
};

export const runProfileIncrementalSyncToCompletion = async (
  input: Readonly<
    ProfileSyncBatchInput & {
      updatedAfter: number;
      overlapMs: number;
      delayMs: number;
    }
  >,
): Promise<{
  batchId: string;
  upserted: number;
  unchanged: number;
  done: true;
  watermark: number | null;
}> => {
  if (!Number.isSafeInteger(input.delayMs) || input.delayMs < 0) {
    throw new Error("Profile incremental sync delay must be a non-negative safe integer");
  }
  let upserted = 0;
  let unchanged = 0;
  let watermark: number | null = null;
  while (true) {
    const result = await runProfileIncrementalSync(input);
    upserted += result.upserted;
    unchanged += result.unchanged;
    watermark = result.watermark;
    if (result.done) return { batchId: input.batchId, upserted, unchanged, done: true, watermark };
    if (input.delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, input.delayMs));
  }
};

const main = async (): Promise<void> => {
  const syncMode = required(process.env.PROFILE_SYNC_MODE, "PROFILE_SYNC_MODE");
  if (syncMode !== "full" && syncMode !== "incremental") {
    throw new Error("PROFILE_SYNC_MODE must be full or incremental");
  }
  const databaseUrl = required(process.env.DATABASE_URL, "DATABASE_URL");
  if (!databaseUrl.startsWith("mysql")) throw new Error("DATABASE_URL must be a MySQL URL");
  const batchId = process.env.PROFILE_BACKFILL_BATCH_ID?.trim() || randomUUID();
  const pool = createPool({ uri: databaseUrl, connectionLimit: 1, waitForConnections: true });
  try {
    const { authorization } = await authorizeAndPreflightProfileProcess(pool);
    const shared = {
      pool,
      convex: createAuthorizedProfileConvexClient(),
      batchId,
      batchSize: boundedBatchSize(process.env.PROFILE_BACKFILL_BATCH_SIZE),
      approvalRef: authorization.approvalRef,
      requestedBy: process.env.PROFILE_MIGRATION_REQUESTED_BY?.trim() || undefined,
    };
    const result =
      syncMode === "incremental"
        ? await runProfileIncrementalSyncToCompletion({
            ...shared,
            updatedAfter: boundedNonNegativeInteger(
              required(
                process.env.PROFILE_INCREMENTAL_UPDATED_AFTER,
                "PROFILE_INCREMENTAL_UPDATED_AFTER",
              ),
              "PROFILE_INCREMENTAL_UPDATED_AFTER",
            ),
            overlapMs: boundedNonNegativeInteger(
              process.env.PROFILE_INCREMENTAL_OVERLAP_MS ?? "300000",
              "PROFILE_INCREMENTAL_OVERLAP_MS",
            ),
            delayMs: boundedNonNegativeInteger(
              process.env.PROFILE_INCREMENTAL_DELAY_MS ?? "100",
              "PROFILE_INCREMENTAL_DELAY_MS",
            ),
          })
        : await runProfileBackfillToCompletion(shared);
    console.info(
      JSON.stringify({
        event:
          process.env.PROFILE_SYNC_MODE === "incremental"
            ? "profile.incremental.completed"
            : "profile.backfill.completed",
        ...result,
      }),
    );
  } finally {
    await pool.end();
  }
};

if (process.argv[1] && /(?:^|\/)profileBackfillProcess(?:\.ts|\.js)?$/.test(process.argv[1])) {
  await main();
}
