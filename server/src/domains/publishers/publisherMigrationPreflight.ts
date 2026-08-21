import type { Pool, RowDataPacket } from "mysql2/promise";

const REQUIRED_TABLES = [
  "profile_snapshots",
  "publisher_snapshots",
  "publisher_member_snapshots",
  "official_publisher_snapshots",
  "publisher_sync_checkpoints",
  "publisher_avatar_snapshots",
  "convex_exit_migration_batches",
  "convex_exit_legacy_id_maps",
  "convex_exit_reconciliation_records",
  "convex_exit_managed_assets",
  "convex_exit_outbox_events",
  "candidate_fixture_retention_records",
] as const;

const REQUIRED_CONSTRAINTS = [
  [
    "publisher_snapshots_linked_profile_fk",
    "publisher_snapshots",
    "linkedProfileId",
    "profile_snapshots",
    "id",
    "SET NULL",
  ],
  [
    "publisher_member_snapshots_publisher_fk",
    "publisher_member_snapshots",
    "publisherId",
    "publisher_snapshots",
    "id",
    "CASCADE",
  ],
  [
    "publisher_member_snapshots_profile_fk",
    "publisher_member_snapshots",
    "memberProfileId",
    "profile_snapshots",
    "id",
    "RESTRICT",
  ],
  [
    "official_publisher_snapshots_publisher_fk",
    "official_publisher_snapshots",
    "publisherId",
    "publisher_snapshots",
    "id",
    "CASCADE",
  ],
  [
    "official_publisher_snapshots_created_by_profile_fk",
    "official_publisher_snapshots",
    "createdByProfileId",
    "profile_snapshots",
    "id",
    "SET NULL",
  ],
  [
    "publisher_sync_checkpoints_batch_fk",
    "publisher_sync_checkpoints",
    "batchId",
    "convex_exit_migration_batches",
    "id",
    "CASCADE",
  ],
  [
    "publisher_avatar_snapshots_publisher_fk",
    "publisher_avatar_snapshots",
    "publisherId",
    "publisher_snapshots",
    "id",
    "CASCADE",
  ],
  [
    "publisher_avatar_snapshots_target_asset_fk",
    "publisher_avatar_snapshots",
    "targetAssetId",
    "convex_exit_managed_assets",
    "id",
    "SET NULL",
  ],
] as const;

type Queryable = Pick<Pool, "query">;
type NamedRow = RowDataPacket & { name: string };
type CountRow = RowDataPacket & { count: number | bigint };
type BatchRow = RowDataPacket & { id: string };
type ConstraintRow = RowDataPacket & {
  name: string;
  tableName: string;
  columnName: string;
  referencedTableName: string;
  referencedColumnName: string;
  deleteRule: string;
};

export type PublisherMigrationAuthorization = Readonly<{
  environment: "candidate" | "production";
  approvalRef: string;
}>;

export type PublisherMigrationPreflightReport = Readonly<{
  ready: boolean;
  candidateReady: boolean;
  missingTables: readonly string[];
  missingConstraints: readonly string[];
  invalidConstraints: readonly string[];
  missingProfileLinks: number;
  runningBatchIds: readonly string[];
  pendingAssets: number;
  failedAssets: number;
  retainedFixturePendingAssets: number;
  retainedFixtureFailedAssets: number;
  unresolvedDifferences: number;
  unclassifiedDifferences: number;
  retainedFixtureDifferences: number;
}>;

const required = (value: string | undefined, name: string): string => {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
};

export const requirePublisherMigrationAuthorization = (
  environment: NodeJS.ProcessEnv = process.env,
): PublisherMigrationAuthorization => {
  if (environment.PUBLISHER_MIGRATION_EXECUTION !== "1") {
    throw new Error("PUBLISHER_MIGRATION_EXECUTION=1 is required");
  }
  const target = required(environment.PUBLISHER_MIGRATION_ENV, "PUBLISHER_MIGRATION_ENV");
  if (target !== "candidate" && target !== "production") {
    throw new Error("PUBLISHER_MIGRATION_ENV must be candidate or production");
  }
  const productionLike =
    target === "production" || environment.PUBLISHER_MIGRATION_PRODUCTION_TARGET === "1";
  if (productionLike && environment.PUBLISHER_MIGRATION_PRODUCTION_APPROVED !== "1") {
    throw new Error("PUBLISHER_MIGRATION_PRODUCTION_APPROVED=1 is required for production");
  }
  return Object.freeze({
    environment: target,
    approvalRef: required(
      environment.PUBLISHER_MIGRATION_APPROVAL_REF,
      "PUBLISHER_MIGRATION_APPROVAL_REF",
    ),
  });
};

const names = async (database: Queryable, sql: string): Promise<Set<string>> => {
  const [rows] = await database.query<NamedRow[]>(sql);
  return new Set(rows.map((row) => row.name));
};

const count = async (database: Queryable, sql: string): Promise<number> => {
  const [rows] = await database.query<CountRow[]>(sql);
  return Number(rows[0]?.count ?? 0);
};

export const inspectPublisherMigrationReadiness = async (
  database: Queryable,
): Promise<PublisherMigrationPreflightReport> => {
  const existingTables = await names(
    database,
    `SELECT TABLE_NAME AS name
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()`,
  );
  const missingTables = REQUIRED_TABLES.filter((table) => !existingTables.has(table));
  if (missingTables.length > 0) {
    return {
      ready: false,
      candidateReady: false,
      missingTables,
      missingConstraints: [],
      invalidConstraints: [],
      missingProfileLinks: 0,
      runningBatchIds: [],
      pendingAssets: 0,
      failedAssets: 0,
      retainedFixturePendingAssets: 0,
      retainedFixtureFailedAssets: 0,
      unresolvedDifferences: 0,
      unclassifiedDifferences: 0,
      retainedFixtureDifferences: 0,
    };
  }

  const [constraintRows] = await database.query<ConstraintRow[]>(
    `SELECT rc.CONSTRAINT_NAME AS name,
            rc.TABLE_NAME AS tableName,
            kcu.COLUMN_NAME AS columnName,
            rc.REFERENCED_TABLE_NAME AS referencedTableName,
            kcu.REFERENCED_COLUMN_NAME AS referencedColumnName,
            rc.DELETE_RULE AS deleteRule
     FROM information_schema.REFERENTIAL_CONSTRAINTS rc
     INNER JOIN information_schema.KEY_COLUMN_USAGE kcu
       ON kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
      AND kcu.TABLE_NAME = rc.TABLE_NAME
      AND kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
     WHERE rc.CONSTRAINT_SCHEMA = DATABASE()`,
  );
  const constraints = new Map(constraintRows.map((row) => [row.name, row]));
  const missingConstraints = REQUIRED_CONSTRAINTS.filter(([name]) => !constraints.has(name)).map(
    ([name]) => name,
  );
  const invalidConstraints = REQUIRED_CONSTRAINTS.flatMap(
    ([name, table, column, referencedTable, referencedColumn, deleteRule]) => {
      const actual = constraints.get(name);
      if (!actual) return [];
      return actual.tableName === table &&
        actual.columnName === column &&
        actual.referencedTableName === referencedTable &&
        actual.referencedColumnName === referencedColumn &&
        actual.deleteRule === deleteRule
        ? []
        : [name];
    },
  );
  const [batchRows] = await database.query<BatchRow[]>(
    `SELECT id
     FROM convex_exit_migration_batches
     WHERE domain = 'publishers' AND status = 'running'
     ORDER BY startedAt ASC`,
  );
  const [
    missingProfileLinks,
    pendingAssets,
    failedAssets,
    retainedFixturePendingAssets,
    retainedFixtureFailedAssets,
    unresolvedDifferences,
    unclassifiedDifferences,
    retainedFixtureDifferences,
  ] = await Promise.all([
    count(
      database,
      `SELECT COUNT(*) AS count
         FROM publisher_snapshots
         WHERE kind = 'user' AND linkedUserLegacyConvexId IS NOT NULL AND linkedProfileId IS NULL`,
    ),
    count(
      database,
      `SELECT COUNT(*) AS count
       FROM publisher_avatar_snapshots asset
       INNER JOIN publisher_snapshots publisher ON publisher.id = asset.publisherId
       LEFT JOIN candidate_fixture_retention_records retained
         ON retained.domain = 'publishers' AND retained.legacyConvexId = publisher.legacyConvexId
       WHERE asset.status IN ('pending', 'processing', 'external') AND retained.id IS NULL`,
    ),
    count(
      database,
      `SELECT COUNT(*) AS count
       FROM publisher_avatar_snapshots asset
       INNER JOIN publisher_snapshots publisher ON publisher.id = asset.publisherId
       LEFT JOIN candidate_fixture_retention_records retained
         ON retained.domain = 'publishers' AND retained.legacyConvexId = publisher.legacyConvexId
       WHERE asset.status = 'failed' AND retained.id IS NULL`,
    ),
    count(
      database,
      `SELECT COUNT(*) AS count
       FROM publisher_avatar_snapshots asset
       INNER JOIN publisher_snapshots publisher ON publisher.id = asset.publisherId
       INNER JOIN candidate_fixture_retention_records retained
         ON retained.domain = 'publishers' AND retained.legacyConvexId = publisher.legacyConvexId
       WHERE asset.status IN ('pending', 'processing', 'external')`,
    ),
    count(
      database,
      `SELECT COUNT(*) AS count
       FROM publisher_avatar_snapshots asset
       INNER JOIN publisher_snapshots publisher ON publisher.id = asset.publisherId
       INNER JOIN candidate_fixture_retention_records retained
         ON retained.domain = 'publishers' AND retained.legacyConvexId = publisher.legacyConvexId
       WHERE asset.status = 'failed'`,
    ),
    count(
      database,
      `SELECT COUNT(*) AS count
       FROM convex_exit_reconciliation_records
       WHERE domain = 'publishers' AND resolvedAt IS NULL
         AND classification <> 'expected_retired_fixture'`,
    ),
    count(
      database,
      `SELECT COUNT(*) AS count
       FROM convex_exit_reconciliation_records
       WHERE domain = 'publishers' AND classification = 'unclassified' AND resolvedAt IS NULL`,
    ),
    count(
      database,
      `SELECT COUNT(*) AS count
       FROM convex_exit_reconciliation_records
       WHERE domain = 'publishers' AND classification = 'expected_retired_fixture' AND resolvedAt IS NULL`,
    ),
  ]);
  const ready = missingConstraints.length === 0 && invalidConstraints.length === 0;
  return {
    ready,
    candidateReady:
      ready &&
      batchRows.length === 0 &&
      missingProfileLinks === 0 &&
      pendingAssets === 0 &&
      failedAssets === 0 &&
      unresolvedDifferences === 0,
    missingTables,
    missingConstraints,
    invalidConstraints,
    missingProfileLinks,
    runningBatchIds: batchRows.map((row) => row.id),
    pendingAssets,
    failedAssets,
    retainedFixturePendingAssets,
    retainedFixtureFailedAssets,
    unresolvedDifferences,
    unclassifiedDifferences,
    retainedFixtureDifferences,
  };
};
