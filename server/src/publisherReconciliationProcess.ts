import { createHash, randomUUID } from "node:crypto";
import { makeFunctionReference } from "convex/server";
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";
import { createMigrationPort } from "./domains/migration/migrationPort.js";
import { createCandidateFixtureRetentionRepository } from "./domains/migration/candidateFixtureRetention.js";
import { createConvexPublisherAvatarSourceReader } from "./domains/publishers/convexPublisherAvatarSourceReader.js";
import { createConvexPublisherMigrationSource } from "./domains/publishers/convexPublisherMigrationSource.js";
import {
  inspectPublisherMigrationReadiness,
  requirePublisherMigrationAuthorization,
} from "./domains/publishers/publisherMigrationPreflight.js";
import {
  publisherBatchSize,
  requirePublisherMysqlDatabaseUrl,
} from "./domains/publishers/publisherMigrationRuntime.js";
import type {
  OfficialPublisherSourceSnapshot,
  PublisherMemberSourceSnapshot,
  PublisherSourceSnapshot,
} from "./domains/publishers/publisherMigrationSource.js";
import type {
  PublisherReconciliationSource,
  PublisherReconciliationTarget,
} from "./domains/publishers/publisherReconciliationRunner.js";
import { runPublisherReconciliation } from "./domains/publishers/publisherReconciliationRunner.js";
import { createAuthorizedPublisherConvexClient } from "./publisherSyncProcess.js";

type PublisherRow = RowDataPacket & {
  legacyConvexId: string;
  legacyCreationTime: number | bigint;
  kind: "user" | "org";
  handle: string;
  displayName: string;
  bio: string | null;
  sourceImageUrl: string | null;
  sourceImageStorageId: string | null;
  linkedUserLegacyConvexId: string | null;
  trustedPublisher: number | boolean;
  publishedSkills: number;
  publishedPackages: number;
  totalInstalls: number;
  totalDownloads: number;
  totalStars: number;
  skillTotalInstalls: number;
  skillTotalDownloads: number;
  skillTotalStars: number;
  deletedAt: Date | string | null;
  deactivatedAt: Date | string | null;
  legacyCreatedAt: Date | string;
  legacyUpdatedAt: Date | string;
};

type MemberRow = RowDataPacket & {
  legacyConvexId: string;
  legacyCreationTime: number | bigint;
  publisherLegacyConvexId: string;
  memberUserLegacyConvexId: string;
  role: "owner" | "admin" | "publisher";
  legacyCreatedAt: Date | string;
  legacyUpdatedAt: Date | string;
};

type OfficialRow = RowDataPacket & {
  legacyConvexId: string;
  legacyCreationTime: number | bigint;
  publisherLegacyConvexId: string;
  reason: string | null;
  createdByUserLegacyConvexId: string | null;
  legacyCreatedAt: Date | string;
  legacyUpdatedAt: Date | string;
};

type UserRow = RowDataPacket & {
  legacyConvexId: string;
  role: string | null;
  deletedAt: Date | string | null;
  deactivatedAt: Date | string | null;
  purgedAt: Date | string | null;
};

type AvatarRow = RowDataPacket & {
  legacyStorageId: string;
  mimeType: string;
  sizeBytes: number | bigint;
  sha256: string;
  assetStatus: string;
  snapshotStatus: string;
};

type ConvexUserFact = Readonly<{
  legacyUserId: string;
  active: boolean;
  platformRole: "admin" | "moderator" | "user" | null;
}>;

const userFactsReference = makeFunctionReference<
  "query",
  { legacyUserIds: string[] },
  ConvexUserFact[]
>("publisherMigration:getPublisherUserFactsInternal");

const milliseconds = (value: Date | string | null): number | null =>
  value === null ? null : new Date(value).getTime();

const toPublisher = (row: PublisherRow): PublisherSourceSnapshot => ({
  legacyConvexId: row.legacyConvexId,
  legacyCreationTime: Number(row.legacyCreationTime),
  kind: row.kind,
  handle: row.handle,
  displayName: row.displayName,
  bio: row.bio,
  image: row.sourceImageUrl,
  imageStorageId: row.sourceImageStorageId,
  linkedUserLegacyConvexId: row.linkedUserLegacyConvexId,
  trustedPublisher: Boolean(row.trustedPublisher),
  publishedSkills: row.publishedSkills,
  publishedPackages: row.publishedPackages,
  totalInstalls: row.totalInstalls,
  totalDownloads: row.totalDownloads,
  totalStars: row.totalStars,
  skillTotalInstalls: row.skillTotalInstalls,
  skillTotalDownloads: row.skillTotalDownloads,
  skillTotalStars: row.skillTotalStars,
  deletedAt: milliseconds(row.deletedAt),
  deactivatedAt: milliseconds(row.deactivatedAt),
  legacyCreatedAt: milliseconds(row.legacyCreatedAt) ?? 0,
  legacyUpdatedAt: milliseconds(row.legacyUpdatedAt) ?? 0,
});

const toMember = (row: MemberRow): PublisherMemberSourceSnapshot => ({
  legacyConvexId: row.legacyConvexId,
  legacyCreationTime: Number(row.legacyCreationTime),
  publisherLegacyConvexId: row.publisherLegacyConvexId,
  memberUserLegacyConvexId: row.memberUserLegacyConvexId,
  role: row.role,
  legacyCreatedAt: milliseconds(row.legacyCreatedAt) ?? 0,
  legacyUpdatedAt: milliseconds(row.legacyUpdatedAt) ?? 0,
});

const toOfficial = (row: OfficialRow): OfficialPublisherSourceSnapshot => ({
  legacyConvexId: row.legacyConvexId,
  legacyCreationTime: Number(row.legacyCreationTime),
  publisherLegacyConvexId: row.publisherLegacyConvexId,
  reason: row.reason,
  createdByUserLegacyConvexId: row.createdByUserLegacyConvexId,
  legacyCreatedAt: milliseconds(row.legacyCreatedAt) ?? 0,
  legacyUpdatedAt: milliseconds(row.legacyUpdatedAt) ?? 0,
});

const createSourceSide = (
  convex: ReturnType<typeof createAuthorizedPublisherConvexClient>,
  pageSize: number,
): PublisherReconciliationSource => {
  const source = createConvexPublisherMigrationSource({
    query: (reference, args) => convex.query(reference, args),
  });
  const avatarReader = createConvexPublisherAvatarSourceReader({
    query: (reference, args) => convex.query(reference, args),
  });
  const iterate = async function* <T>(
    load: (input: { cursor: string | null; limit: number }) => Promise<
      Readonly<{
        items: readonly T[];
        cursor: string | null;
        done: boolean;
      }>
    >,
  ): AsyncIterable<T> {
    let cursor: string | null = null;
    do {
      const page = await load({ cursor, limit: pageSize });
      yield* page.items;
      cursor = page.cursor;
      if (page.done) break;
      if (!cursor)
        throw new Error("Publisher reconciliation source page is incomplete without a cursor");
    } while (cursor);
  };
  return Object.freeze({
    publishers: () => iterate(source.listPublishers),
    members: () => iterate(source.listMembers),
    officialPublishers: () => iterate(source.listOfficialPublishers),
    users: async (legacyUserIds) => {
      const result = new Map<string, ConvexUserFact>();
      for (let offset = 0; offset < legacyUserIds.length; offset += 250) {
        const facts = await convex.query(userFactsReference, {
          legacyUserIds: [...legacyUserIds.slice(offset, offset + 250)],
        });
        for (const fact of facts) result.set(fact.legacyUserId, fact);
      }
      return result;
    },
    avatarMetadata: async (storageId) => {
      const sourceAvatar = await avatarReader.read(storageId);
      if (!sourceAvatar) return null;
      const hash = createHash("sha256");
      let sizeBytes = 0;
      for await (const rawChunk of sourceAvatar.stream) {
        const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
        sizeBytes += chunk.length;
        hash.update(chunk);
      }
      return {
        mimeType: sourceAvatar.declaredMimeType,
        sizeBytes,
        sha256: hash.digest("hex"),
      };
    },
  });
};

const createTargetSide = (pool: Pool): PublisherReconciliationTarget =>
  Object.freeze({
    publishers: async function* () {
      const [rows] = await pool.query<PublisherRow[]>(
        `SELECT publisher.legacyConvexId, publisher.legacyCreationTime, publisher.kind,
              publisher.handle, publisher.displayName, publisher.bio, publisher.sourceImageUrl,
              publisher.sourceImageStorageId, publisher.linkedUserLegacyConvexId,
              publisher.trustedPublisher, publisher.publishedSkills, publisher.publishedPackages,
              publisher.totalInstalls, publisher.totalDownloads, publisher.totalStars,
              publisher.skillTotalInstalls, publisher.skillTotalDownloads, publisher.skillTotalStars,
              publisher.deletedAt, publisher.deactivatedAt, publisher.legacyCreatedAt,
              publisher.legacyUpdatedAt
       FROM publisher_snapshots publisher
       LEFT JOIN candidate_fixture_retention_records retained
         ON retained.domain = 'publishers' AND retained.legacyConvexId = publisher.legacyConvexId
       WHERE publisher.sourceMissingAt IS NULL OR retained.legacyConvexId IS NOT NULL
       ORDER BY publisher.legacyConvexId ASC`,
      );
      for (const row of rows) yield toPublisher(row);
    },
    members: async function* () {
      const [rows] = await pool.query<MemberRow[]>(
        `SELECT member.legacyConvexId, member.legacyCreationTime,
              publisher.legacyConvexId AS publisherLegacyConvexId,
              member.memberUserLegacyConvexId, member.role,
              member.legacyCreatedAt, member.legacyUpdatedAt
       FROM publisher_member_snapshots member
       INNER JOIN publisher_snapshots publisher ON publisher.id = member.publisherId
       ORDER BY member.legacyConvexId ASC`,
      );
      for (const row of rows) yield toMember(row);
    },
    officialPublishers: async function* () {
      const [rows] = await pool.query<OfficialRow[]>(
        `SELECT official.legacyConvexId, official.legacyCreationTime,
              publisher.legacyConvexId AS publisherLegacyConvexId,
              official.reason, official.createdByUserLegacyConvexId,
              official.legacyCreatedAt, official.legacyUpdatedAt
       FROM official_publisher_snapshots official
       INNER JOIN publisher_snapshots publisher ON publisher.id = official.publisherId
       ORDER BY official.legacyConvexId ASC`,
      );
      for (const row of rows) yield toOfficial(row);
    },
    users: async (legacyUserIds) => {
      if (legacyUserIds.length === 0) return new Map();
      const placeholders = legacyUserIds.map(() => "?").join(", ");
      const [rows] = await pool.query<UserRow[]>(
        `SELECT legacyConvexId, role, deletedAt, deactivatedAt, purgedAt
       FROM profile_snapshots
       WHERE legacyConvexId IN (${placeholders})`,
        [...legacyUserIds],
      );
      const users = new Map(
        rows.map((row) => [
          row.legacyConvexId,
          {
            active: !row.deletedAt && !row.deactivatedAt && !row.purgedAt,
            platformRole:
              row.role === "admin" || row.role === "moderator" || row.role === "user"
                ? row.role
                : null,
          },
        ]),
      );
      for (const legacyUserId of legacyUserIds) {
        if (!users.has(legacyUserId))
          users.set(legacyUserId, { active: false, platformRole: null });
      }
      return users;
    },
    findAvatar: async (legacyStorageId) => {
      const [rows] = await pool.query<AvatarRow[]>(
        `SELECT asset.legacyStorageId, asset.mimeType, asset.sizeBytes, asset.sha256,
                asset.status AS assetStatus, avatar.status AS snapshotStatus
         FROM convex_exit_managed_assets asset
         INNER JOIN publisher_avatar_snapshots avatar ON avatar.targetAssetId = asset.id
         WHERE asset.ownerDomain = 'publishers' AND asset.legacyStorageId = ?
           AND avatar.sourceStorageId = ?
         LIMIT 1`,
        [legacyStorageId, legacyStorageId],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        legacyStorageId: row.legacyStorageId,
        mimeType: row.mimeType,
        sizeBytes: Number(row.sizeBytes),
        sha256: row.sha256,
        assetStatus: row.assetStatus === "deleted" ? ("deleted" as const) : ("active" as const),
        snapshotStatus: row.snapshotStatus,
      };
    },
  });

export const runPublisherReconciliationProcess = async (
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> => {
  const authorization = requirePublisherMigrationAuthorization(environment);
  const pool = createPool({
    uri: requirePublisherMysqlDatabaseUrl(environment),
    connectionLimit: 4,
    waitForConnections: true,
    enableKeepAlive: true,
  });
  const batchId = environment.PUBLISHER_RECONCILIATION_BATCH_ID?.trim() || randomUUID();
  try {
    const readiness = await inspectPublisherMigrationReadiness(pool);
    if (!readiness.ready) throw new Error("Publisher migration schema preflight is not ready");
    const migration = createMigrationPort({
      query: (sql, values) => pool.query(sql, values ? [...values] : undefined),
    });
    await migration.startBatch({
      id: batchId,
      domain: "publishers",
      source: "convex-publisher-reconciliation",
      approvalRef: authorization.approvalRef,
      requestedBy: environment.PUBLISHER_MIGRATION_REQUESTED_BY?.trim() || undefined,
    });
    try {
      const convex = createAuthorizedPublisherConvexClient(environment);
      const summary = await runPublisherReconciliation({
        batchId,
        source: createSourceSide(
          convex,
          publisherBatchSize(environment.PUBLISHER_RECONCILIATION_PAGE_SIZE),
        ),
        target: createTargetSide(pool),
        classifyDifference: async (difference) => {
          const retained = await createCandidateFixtureRetentionRepository({
            query: (sql, values) => pool.query(sql, values ? [...values] : undefined),
          }).classifyTargetOnly({ domain: 'publishers', ...difference });
          return retained ? 'expected_retired_fixture' : 'unclassified';
        },
        sink: {
          record: (difference) =>
            migration.recordDifference({
              domain: "publishers",
              ...difference,
            }),
        },
      });
      await pool.query(
        `UPDATE convex_exit_reconciliation_records
         SET resolvedAt = CURRENT_TIMESTAMP(3)
         WHERE domain = 'publishers' AND resolvedAt IS NULL AND (batchId IS NULL OR batchId <> ?)`,
        [batchId],
      );
      await migration.persistProgress(batchId, {
        cursor: null,
        sourceCount: BigInt(
          summary.sourcePublishers + summary.sourceMembers + summary.sourceOfficialPublishers,
        ),
        upsertedCount: 0n,
        unchangedCount: BigInt(
          summary.targetPublishers + summary.targetMembers + summary.targetOfficialPublishers,
        ),
        errorCount: 0n,
        completed: true,
      });
      console.info(
        JSON.stringify({
          event: "publisher.reconciliation.completed",
          environment: authorization.environment,
          approvalRef: authorization.approvalRef,
          ...summary,
        }),
      );
    } catch (error) {
      await migration.recordFailure(
        batchId,
        error instanceof Error ? error.message.slice(0, 128) : "publisher_reconciliation_failed",
      );
      throw error;
    }
  } finally {
    await pool.end();
  }
};

if (
  process.argv[1] &&
  /(?:^|\/)publisherReconciliationProcess(?:\.ts|\.js)?$/.test(process.argv[1])
) {
  await runPublisherReconciliationProcess();
}
