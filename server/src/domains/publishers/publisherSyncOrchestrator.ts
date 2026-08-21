import { createHash, randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { createMigrationPort } from "../migration/migrationPort.js";
import type {
  OfficialPublisherSourceSnapshot,
  PublisherMemberSourceSnapshot,
  PublisherMigrationSource,
  PublisherSourceSnapshot,
} from "./publisherMigrationSource.js";

type SqlValue = {} | null | undefined;

type SqlExecutor = Readonly<{
  query: (sql: string, values?: SqlValue[]) => Promise<unknown>;
}>;

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

type SyncPhase = "publishers" | "members" | "official";

type PublisherSyncCursor = Readonly<{
  version: 1;
  mode: "full";
  phase: SyncPhase;
  sourceCursor: string | null;
  watermark: number;
}>;

type SnapshotRow = RowDataPacket &
  Readonly<{ id: string; legacyConvexId: string; sourceHash: string }>;
type TargetRow = RowDataPacket & Readonly<{ targetId: string }>;
type BatchRow = RowDataPacket & Readonly<{ id: string }>;

type PageCounts = Readonly<{ upserted: number; unchanged: number }>;

export type PublisherSyncInput = Readonly<{
  pool: TransactionalPool;
  source: PublisherMigrationSource;
  batchId: string;
  batchSize: number;
  approvalRef?: string;
  requestedBy?: string;
  now?: () => number;
}>;

export type PublisherSyncResult = Readonly<{
  batchId: string;
  phase: SyncPhase;
  upserted: number;
  unchanged: number;
  done: boolean;
}>;

const rows = <T>(result: unknown): T[] => {
  if (!Array.isArray(result) || !Array.isArray(result[0])) return [];
  return result[0] as T[];
};

const required = (value: string, name: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
};

const isoDate = (milliseconds: number | null): Date | null =>
  milliseconds === null ? null : new Date(milliseconds);

const stableHash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const migrationPortFor = (executor: SqlExecutor) =>
  createMigrationPort({
    query: (sql, values) => executor.query(sql, values ? ([...values] as SqlValue[]) : undefined),
  });

export const encodePublisherSyncCursor = (cursor: PublisherSyncCursor): string =>
  JSON.stringify(cursor);

export const decodePublisherSyncCursor = (value: string | null): PublisherSyncCursor | null => {
  if (value === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Publisher sync cursor is invalid JSON");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Publisher sync cursor is invalid");
  const candidate = parsed as Partial<PublisherSyncCursor>;
  if (
    candidate.version !== 1 ||
    candidate.mode !== "full" ||
    !["publishers", "members", "official"].includes(candidate.phase ?? "") ||
    (candidate.sourceCursor !== null && typeof candidate.sourceCursor !== "string") ||
    typeof candidate.watermark !== "number" ||
    !Number.isSafeInteger(candidate.watermark) ||
    candidate.watermark < 0
  ) {
    throw new Error("Publisher sync cursor is invalid");
  }
  return candidate as PublisherSyncCursor;
};

const nextCursor = (
  current: PublisherSyncCursor,
  page: Readonly<{ cursor: string | null; done: boolean }>,
): PublisherSyncCursor | null => {
  if (!page.done) {
    if (!page.cursor)
      throw new Error("Publisher source returned an incomplete page without a cursor");
    return { ...current, sourceCursor: page.cursor };
  }
  if (current.phase === "publishers") {
    return { ...current, phase: "members", sourceCursor: null };
  }
  if (current.phase === "members") {
    return { ...current, phase: "official", sourceCursor: null };
  }
  return null;
};

const resolveProfileId = async (
  executor: SqlExecutor,
  legacyUserId: string,
  relation: string,
): Promise<string> => {
  const [row] = rows<TargetRow>(
    await executor.query(
      `SELECT legacyMap.targetId
       FROM convex_exit_legacy_id_maps legacyMap
       INNER JOIN profile_snapshots profile ON profile.id = legacyMap.targetId
       WHERE legacyMap.domain = 'profiles' AND legacyMap.legacyConvexId = ?
       LIMIT 1`,
      [required(legacyUserId, `${relation} legacy user ID`)],
    ),
  );
  if (!row) throw new Error(`Missing Profile legacy map for ${relation}: ${legacyUserId}`);
  return row.targetId;
};

const resolvePublisherId = async (
  executor: SqlExecutor,
  legacyPublisherId: string,
): Promise<string> => {
  const [row] = rows<TargetRow>(
    await executor.query(
      `SELECT legacyMap.targetId
       FROM convex_exit_legacy_id_maps legacyMap
       INNER JOIN publisher_snapshots publisher ON publisher.id = legacyMap.targetId
       WHERE legacyMap.domain = 'publishers' AND legacyMap.legacyConvexId = ?
       LIMIT 1`,
      [required(legacyPublisherId, "publisher legacy Convex ID")],
    ),
  );
  if (!row) throw new Error(`Missing Publisher legacy map: ${legacyPublisherId}`);
  return row.targetId;
};

const ensurePublisherIdentityAvailable = async (
  executor: SqlExecutor,
  snapshot: PublisherSourceSnapshot,
): Promise<SnapshotRow | undefined> => {
  const matches = rows<SnapshotRow>(
    await executor.query(
      `SELECT id, legacyConvexId, sourceHash
       FROM publisher_snapshots
       WHERE legacyConvexId = ?
          OR handle = ?
          OR (? IS NOT NULL AND linkedUserLegacyConvexId = ?)
       LIMIT 3`,
      [
        snapshot.legacyConvexId,
        snapshot.handle,
        snapshot.linkedUserLegacyConvexId,
        snapshot.linkedUserLegacyConvexId,
      ],
    ),
  );
  const conflict = matches.find((row) => row.legacyConvexId !== snapshot.legacyConvexId);
  if (conflict)
    throw new Error("Publisher canonical identity maps to a different legacy Convex ID");
  return matches[0];
};

const enqueuePublisherAvatar = async (
  executor: SqlExecutor,
  publisherId: string,
  snapshot: PublisherSourceSnapshot,
): Promise<void> => {
  if (snapshot.kind !== "org") return;
  const explicitlyDeleted = snapshot.deletedAt !== null;
  const status = explicitlyDeleted
    ? "deleted"
    : snapshot.imageStorageId
      ? "pending"
      : snapshot.image
        ? "external"
        : "not_applicable";
  await executor.query(
    `INSERT INTO publisher_avatar_snapshots
       (id, publisherId, sourceStorageId, sourceUrl, status, failureCode, deletedAt)
     VALUES (?, ?, ?, ?, ?, NULL, ?)
     ON DUPLICATE KEY UPDATE
       sourceUrl = VALUES(sourceUrl),
       deletedAt = VALUES(deletedAt),
       failureCode = IF(sourceStorageId <> VALUES(sourceStorageId), NULL, failureCode),
       status = CASE
         WHEN VALUES(deletedAt) IS NOT NULL THEN 'deleted'
         WHEN VALUES(sourceStorageId) IS NULL AND VALUES(sourceUrl) IS NOT NULL THEN 'external'
         WHEN VALUES(sourceStorageId) IS NULL THEN 'not_applicable'
         WHEN sourceStorageId <> VALUES(sourceStorageId) OR sourceStorageId IS NULL THEN 'pending'
         ELSE status
       END,
       sourceStorageId = VALUES(sourceStorageId)`,
    [
      randomUUID(),
      publisherId,
      snapshot.imageStorageId,
      snapshot.image,
      status,
      isoDate(snapshot.deletedAt),
    ],
  );
  if (!snapshot.imageStorageId || explicitlyDeleted) return;
  const sourceVersion = BigInt(
    Math.max(0, Math.trunc(snapshot.legacyUpdatedAt || snapshot.legacyCreationTime)),
  );
  await migrationPortFor(executor).publishDomainEvent({
    domain: "publishers",
    aggregateId: snapshot.legacyConvexId,
    aggregateVersion: sourceVersion,
    eventType: "publishers.avatar.import-requested",
    idempotencyKey: `publisher-avatar:${snapshot.imageStorageId}:${sourceVersion}`,
    payload: {
      legacyConvexId: snapshot.legacyConvexId,
      publisherId,
      sourceStorageId: snapshot.imageStorageId,
    },
  });
};

const upsertPublisher = async (
  executor: SqlExecutor,
  batchId: string,
  snapshot: PublisherSourceSnapshot,
): Promise<"upserted" | "unchanged"> => {
  if (snapshot.kind === "user" && !snapshot.linkedUserLegacyConvexId) {
    throw new Error(`Personal Publisher is missing linked user: ${snapshot.legacyConvexId}`);
  }
  if (snapshot.kind === "org" && snapshot.linkedUserLegacyConvexId) {
    throw new Error(`Organization Publisher has a linked user: ${snapshot.legacyConvexId}`);
  }
  const linkedProfileId = snapshot.linkedUserLegacyConvexId
    ? await resolveProfileId(executor, snapshot.linkedUserLegacyConvexId, "Publisher linked user")
    : null;
  const existing = await ensurePublisherIdentityAvailable(executor, snapshot);
  const sourceHash = stableHash(snapshot);
  const id = existing?.id ?? randomUUID();
  const unchanged = existing?.sourceHash === sourceHash;
  await executor.query(
    `INSERT INTO publisher_snapshots (
       id, legacyConvexId, kind, handle, displayName, bio, sourceImageUrl,
       sourceImageStorageId, linkedProfileId, linkedUserLegacyConvexId, trustedPublisher,
       publishedSkills, publishedPackages, totalInstalls, totalDownloads, totalStars,
       skillTotalInstalls, skillTotalDownloads, skillTotalStars, deletedAt, deactivatedAt,
       legacyCreationTime, legacyCreatedAt, legacyUpdatedAt, sourceHash, lastSeenBatchId,
       sourceMissingAt, syncedAt
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE
       kind = VALUES(kind), handle = VALUES(handle), displayName = VALUES(displayName),
       bio = VALUES(bio), sourceImageUrl = VALUES(sourceImageUrl),
       sourceImageStorageId = VALUES(sourceImageStorageId), linkedProfileId = VALUES(linkedProfileId),
       linkedUserLegacyConvexId = VALUES(linkedUserLegacyConvexId),
       trustedPublisher = VALUES(trustedPublisher), publishedSkills = VALUES(publishedSkills),
       publishedPackages = VALUES(publishedPackages), totalInstalls = VALUES(totalInstalls),
       totalDownloads = VALUES(totalDownloads), totalStars = VALUES(totalStars),
       skillTotalInstalls = VALUES(skillTotalInstalls),
       skillTotalDownloads = VALUES(skillTotalDownloads), skillTotalStars = VALUES(skillTotalStars),
       deletedAt = VALUES(deletedAt), deactivatedAt = VALUES(deactivatedAt),
       legacyCreationTime = VALUES(legacyCreationTime), legacyCreatedAt = VALUES(legacyCreatedAt),
       legacyUpdatedAt = VALUES(legacyUpdatedAt), sourceHash = VALUES(sourceHash),
       lastSeenBatchId = VALUES(lastSeenBatchId), sourceMissingAt = NULL,
       syncedAt = CURRENT_TIMESTAMP(3)`,
    [
      id,
      snapshot.legacyConvexId,
      snapshot.kind,
      snapshot.handle,
      snapshot.displayName,
      snapshot.bio,
      snapshot.image,
      snapshot.imageStorageId,
      linkedProfileId,
      snapshot.linkedUserLegacyConvexId,
      snapshot.trustedPublisher,
      snapshot.publishedSkills,
      snapshot.publishedPackages,
      snapshot.totalInstalls,
      snapshot.totalDownloads,
      snapshot.totalStars,
      snapshot.skillTotalInstalls,
      snapshot.skillTotalDownloads,
      snapshot.skillTotalStars,
      isoDate(snapshot.deletedAt),
      isoDate(snapshot.deactivatedAt),
      snapshot.legacyCreationTime,
      isoDate(snapshot.legacyCreatedAt),
      isoDate(snapshot.legacyUpdatedAt),
      sourceHash,
      batchId,
    ],
  );
  await migrationPortFor(executor).ensureLegacyIdMap({
    domain: "publishers",
    legacyConvexId: snapshot.legacyConvexId,
    targetId: id,
  });
  await enqueuePublisherAvatar(executor, id, snapshot);
  return unchanged ? "unchanged" : "upserted";
};

const findChildSnapshot = async (
  executor: SqlExecutor,
  table: "publisher_member_snapshots" | "official_publisher_snapshots",
  snapshot: Readonly<{ legacyConvexId: string }>,
  publisherId: string,
  uniqueColumn?: Readonly<{ name: string; value: string }>,
): Promise<SnapshotRow | undefined> => {
  const uniqueClause = uniqueColumn
    ? ` OR (${uniqueColumn.name} = ? AND publisherId = ?)`
    : " OR publisherId = ?";
  const values = uniqueColumn
    ? [snapshot.legacyConvexId, uniqueColumn.value, publisherId]
    : [snapshot.legacyConvexId, publisherId];
  const matches = rows<SnapshotRow>(
    await executor.query(
      `SELECT id, legacyConvexId, sourceHash FROM ${table}
       WHERE legacyConvexId = ?${uniqueClause}
       LIMIT 2`,
      values,
    ),
  );
  const conflict = matches.find((row) => row.legacyConvexId !== snapshot.legacyConvexId);
  if (conflict) throw new Error(`${table} unique identity maps to a different legacy Convex ID`);
  return matches[0];
};

const upsertMember = async (
  executor: SqlExecutor,
  batchId: string,
  snapshot: PublisherMemberSourceSnapshot,
): Promise<"upserted" | "unchanged"> => {
  const publisherId = await resolvePublisherId(executor, snapshot.publisherLegacyConvexId);
  const memberProfileId = await resolveProfileId(
    executor,
    snapshot.memberUserLegacyConvexId,
    "Publisher member",
  );
  const existing = await findChildSnapshot(
    executor,
    "publisher_member_snapshots",
    snapshot,
    publisherId,
    {
      name: "memberUserLegacyConvexId",
      value: snapshot.memberUserLegacyConvexId,
    },
  );
  const sourceHash = stableHash(snapshot);
  const unchanged = existing?.sourceHash === sourceHash;
  await executor.query(
    `INSERT INTO publisher_member_snapshots (
       id, legacyConvexId, publisherId, memberProfileId, memberUserLegacyConvexId, role,
       legacyCreationTime, legacyCreatedAt, legacyUpdatedAt, sourceHash, lastSeenBatchId, syncedAt
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE
       publisherId = VALUES(publisherId), memberProfileId = VALUES(memberProfileId),
       memberUserLegacyConvexId = VALUES(memberUserLegacyConvexId), role = VALUES(role),
       legacyCreationTime = VALUES(legacyCreationTime), legacyCreatedAt = VALUES(legacyCreatedAt),
       legacyUpdatedAt = VALUES(legacyUpdatedAt), sourceHash = VALUES(sourceHash),
       lastSeenBatchId = VALUES(lastSeenBatchId), syncedAt = CURRENT_TIMESTAMP(3)`,
    [
      existing?.id ?? randomUUID(),
      snapshot.legacyConvexId,
      publisherId,
      memberProfileId,
      snapshot.memberUserLegacyConvexId,
      snapshot.role,
      snapshot.legacyCreationTime,
      isoDate(snapshot.legacyCreatedAt),
      isoDate(snapshot.legacyUpdatedAt),
      sourceHash,
      batchId,
    ],
  );
  return unchanged ? "unchanged" : "upserted";
};

const upsertOfficial = async (
  executor: SqlExecutor,
  batchId: string,
  snapshot: OfficialPublisherSourceSnapshot,
): Promise<"upserted" | "unchanged"> => {
  const publisherId = await resolvePublisherId(executor, snapshot.publisherLegacyConvexId);
  const createdByProfileId = snapshot.createdByUserLegacyConvexId
    ? await resolveProfileId(
        executor,
        snapshot.createdByUserLegacyConvexId,
        "Official Publisher creator",
      )
    : null;
  const existing = await findChildSnapshot(
    executor,
    "official_publisher_snapshots",
    snapshot,
    publisherId,
  );
  const sourceHash = stableHash(snapshot);
  const unchanged = existing?.sourceHash === sourceHash;
  await executor.query(
    `INSERT INTO official_publisher_snapshots (
       id, legacyConvexId, publisherId, reason, createdByProfileId,
       createdByUserLegacyConvexId, legacyCreationTime, legacyCreatedAt,
       legacyUpdatedAt, sourceHash, lastSeenBatchId, syncedAt
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE
       publisherId = VALUES(publisherId), reason = VALUES(reason),
       createdByProfileId = VALUES(createdByProfileId),
       createdByUserLegacyConvexId = VALUES(createdByUserLegacyConvexId),
       legacyCreationTime = VALUES(legacyCreationTime), legacyCreatedAt = VALUES(legacyCreatedAt),
       legacyUpdatedAt = VALUES(legacyUpdatedAt), sourceHash = VALUES(sourceHash),
       lastSeenBatchId = VALUES(lastSeenBatchId), syncedAt = CURRENT_TIMESTAMP(3)`,
    [
      existing?.id ?? randomUUID(),
      snapshot.legacyConvexId,
      publisherId,
      snapshot.reason,
      createdByProfileId,
      snapshot.createdByUserLegacyConvexId,
      snapshot.legacyCreationTime,
      isoDate(snapshot.legacyCreatedAt),
      isoDate(snapshot.legacyUpdatedAt),
      sourceHash,
      batchId,
    ],
  );
  return unchanged ? "unchanged" : "upserted";
};

const convergeFullScan = async (executor: SqlExecutor, batchId: string): Promise<void> => {
  await executor.query("DELETE FROM official_publisher_snapshots WHERE lastSeenBatchId <> ?", [
    batchId,
  ]);
  await executor.query("DELETE FROM publisher_member_snapshots WHERE lastSeenBatchId <> ?", [
    batchId,
  ]);
  await executor.query(
    `UPDATE publisher_avatar_snapshots avatar
     INNER JOIN publisher_snapshots publisher ON publisher.id = avatar.publisherId
     SET avatar.status = 'deleted', avatar.deletedAt = COALESCE(avatar.deletedAt, CURRENT_TIMESTAMP(3))
     WHERE publisher.lastSeenBatchId <> ?`,
    [batchId],
  );
  await executor.query(
    `UPDATE publisher_snapshots
     SET sourceMissingAt = COALESCE(sourceMissingAt, CURRENT_TIMESTAMP(3)),
         deletedAt = COALESCE(deletedAt, CURRENT_TIMESTAMP(3)),
         syncedAt = CURRENT_TIMESTAMP(3)
     WHERE lastSeenBatchId <> ?`,
    [batchId],
  );
};

const persistCheckpoint = async (
  executor: SqlExecutor,
  batchId: string,
  cursor: PublisherSyncCursor,
  completed: boolean,
  now: number,
): Promise<void> => {
  await executor.query(
    `INSERT INTO publisher_sync_checkpoints
       (id, batchId, watermark, windowStart, cursorAgeMs, retryCount, lastFailureCode, completedAt)
     VALUES (?, ?, ?, 0, ?, 0, NULL, IF(?, CURRENT_TIMESTAMP(3), NULL))
     ON DUPLICATE KEY UPDATE
       watermark = VALUES(watermark), windowStart = 0, cursorAgeMs = VALUES(cursorAgeMs),
       retryCount = 0, lastFailureCode = NULL, completedAt = VALUES(completedAt)`,
    [randomUUID(), batchId, cursor.watermark, Math.max(0, now - cursor.watermark), completed],
  );
};

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

const persistProgress = async (
  executor: SqlExecutor,
  batchId: string,
  cursor: PublisherSyncCursor | null,
  counts: PageCounts,
): Promise<void> => {
  await migrationPortFor(executor).persistProgress(batchId, {
    cursor: cursor ? encodePublisherSyncCursor(cursor) : null,
    upsertedCount: BigInt(counts.upserted),
    unchangedCount: BigInt(counts.unchanged),
    errorCount: 0n,
    completed: cursor === null,
  });
};

const ensureSingleRunningPublisherBatch = async (
  executor: SqlExecutor,
  batchId: string,
): Promise<void> => {
  const [otherBatch] = rows<BatchRow>(
    await executor.query(
      `SELECT id FROM convex_exit_migration_batches
       WHERE domain = 'publishers' AND status = 'running' AND id <> ?
       LIMIT 1`,
      [batchId],
    ),
  );
  if (otherBatch) {
    throw new Error(`Another Publisher migration batch is already running: ${otherBatch.id}`);
  }
};

const recordFailure = async (pool: SqlExecutor, batchId: string): Promise<void> => {
  await migrationPortFor(pool).recordFailure(batchId, "publisher_sync_failed");
  await pool.query(
    `UPDATE publisher_sync_checkpoints
     SET retryCount = retryCount + 1, lastFailureCode = 'publisher_sync_failed'
     WHERE batchId = ?`,
    [batchId],
  );
};

export const runPublisherSyncPage = async (
  input: PublisherSyncInput,
): Promise<PublisherSyncResult> => {
  if (!Number.isSafeInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > 250) {
    throw new Error("Publisher sync batch size must be an integer between 1 and 250");
  }
  const batchId = required(input.batchId, "batch ID");
  const migrationPort = migrationPortFor(input.pool);
  await migrationPort.startBatch({
    id: batchId,
    domain: "publishers",
    source: "convex-publisher-snapshot",
    approvalRef: input.approvalRef,
    requestedBy: input.requestedBy,
  });
  const state = await migrationPort.loadBatchState(batchId);
  const savedCursor = decodePublisherSyncCursor(state?.cursor ?? null);
  const initialCursor: PublisherSyncCursor = savedCursor ?? {
    version: 1,
    mode: "full",
    phase: "publishers",
    sourceCursor: null,
    watermark: (input.now ?? Date.now)(),
  };
  if (state?.status === "completed") {
    return {
      batchId,
      phase: savedCursor?.phase ?? "official",
      upserted: 0,
      unchanged: 0,
      done: true,
    };
  }

  try {
    await ensureSingleRunningPublisherBatch(input.pool, batchId);
    const page =
      initialCursor.phase === "publishers"
        ? await input.source.listPublishers({
            cursor: initialCursor.sourceCursor,
            limit: input.batchSize,
          })
        : initialCursor.phase === "members"
          ? await input.source.listMembers({
              cursor: initialCursor.sourceCursor,
              limit: input.batchSize,
            })
          : await input.source.listOfficialPublishers({
              cursor: initialCursor.sourceCursor,
              limit: input.batchSize,
            });
    const followingCursor = nextCursor(initialCursor, page);
    let upserted = 0;
    let unchanged = 0;
    await persistPageAtomically(input.pool, async (executor) => {
      for (const snapshot of page.items) {
        const outcome =
          initialCursor.phase === "publishers"
            ? await upsertPublisher(executor, batchId, snapshot as PublisherSourceSnapshot)
            : initialCursor.phase === "members"
              ? await upsertMember(executor, batchId, snapshot as PublisherMemberSourceSnapshot)
              : await upsertOfficial(
                  executor,
                  batchId,
                  snapshot as OfficialPublisherSourceSnapshot,
                );
        if (outcome === "upserted") upserted += 1;
        else unchanged += 1;
      }
      if (followingCursor === null) await convergeFullScan(executor, batchId);
      await persistCheckpoint(
        executor,
        batchId,
        initialCursor,
        followingCursor === null,
        (input.now ?? Date.now)(),
      );
      await persistProgress(executor, batchId, followingCursor, { upserted, unchanged });
    });
    return {
      batchId,
      phase: initialCursor.phase,
      upserted,
      unchanged,
      done: followingCursor === null,
    };
  } catch (error) {
    await recordFailure(input.pool, batchId);
    throw error;
  }
};

export const runPublisherSyncToCompletion = async (
  input: PublisherSyncInput,
): Promise<Readonly<{ batchId: string; upserted: number; unchanged: number; done: true }>> => {
  let upserted = 0;
  let unchanged = 0;
  while (true) {
    const result = await runPublisherSyncPage(input);
    upserted += result.upserted;
    unchanged += result.unchanged;
    if (result.done) return { batchId: result.batchId, upserted, unchanged, done: true };
  }
};
