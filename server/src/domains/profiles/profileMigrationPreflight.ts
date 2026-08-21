import type { Pool, RowDataPacket } from 'mysql2/promise';

const REQUIRED_TABLES = [
  'profile_snapshots',
  'profile_sync_checkpoints',
  'profile_identity_aliases',
  'profile_asset_snapshots',
  'convex_exit_migration_batches',
  'convex_exit_legacy_id_maps',
  'convex_exit_reconciliation_records',
  'convex_exit_managed_assets',
  'convex_exit_outbox_events',
  'candidate_fixture_retention_records',
] as const;

const REQUIRED_COLUMNS = [
  ['convex_exit_reconciliation_records', 'classification'],
  ['convex_exit_reconciliation_records', 'resolvedAt'],
  ['convex_exit_outbox_events', 'claimedAt'],
  ['convex_exit_outbox_events', 'leaseExpiresAt'],
  ['profile_asset_snapshots', 'targetAssetId'],
] as const;

const REQUIRED_CONSTRAINTS = [
  {
    name: 'profile_identity_alias_profile_fk',
    table: 'profile_identity_aliases',
    column: 'profileId',
    referencedTable: 'profile_snapshots',
    referencedColumn: 'id',
    deleteRule: 'CASCADE',
  },
  {
    name: 'profile_asset_snapshots_profile_fk',
    table: 'profile_asset_snapshots',
    column: 'profileId',
    referencedTable: 'profile_snapshots',
    referencedColumn: 'id',
    deleteRule: 'CASCADE',
  },
  {
    name: 'profile_sync_checkpoints_batch_fk',
    table: 'profile_sync_checkpoints',
    column: 'batchId',
    referencedTable: 'convex_exit_migration_batches',
    referencedColumn: 'id',
    deleteRule: 'CASCADE',
  },
  {
    name: 'profile_asset_snapshots_target_asset_fk',
    table: 'profile_asset_snapshots',
    column: 'targetAssetId',
    referencedTable: 'convex_exit_managed_assets',
    referencedColumn: 'id',
    deleteRule: 'SET NULL',
  },
  {
    name: 'convex_exit_reconciliation_batch_fk',
    table: 'convex_exit_reconciliation_records',
    column: 'batchId',
    referencedTable: 'convex_exit_migration_batches',
    referencedColumn: 'id',
    deleteRule: 'SET NULL',
  },
] as const;

export type ProfileMigrationEnvironment = 'candidate' | 'production';

export type ProfileMigrationAuthorization = Readonly<{
  environment: ProfileMigrationEnvironment;
  approvalRef: string;
}>;

export type ProfileMigrationPreflightReport = Readonly<{
  ready: boolean;
  candidateReady: boolean;
  missingTables: readonly string[];
  missingColumns: readonly string[];
  missingConstraints: readonly string[];
  invalidConstraints: readonly string[];
  runningBatchIds: readonly string[];
  pendingAssets: number;
  failedAssets: number;
  retainedFixturePendingAssets: number;
  retainedFixtureFailedAssets: number;
  unresolvedDifferences: number;
  unclassifiedDifferences: number;
  retainedFixtureDifferences: number;
}>;

type NamedRow = RowDataPacket & { name: string };
type ConstraintRow = RowDataPacket & {
  name: string;
  tableName: string;
  columnName: string;
  referencedTableName: string;
  referencedColumnName: string;
  deleteRule: string;
};
type CountRow = RowDataPacket & { count: number | bigint };
type BatchRow = RowDataPacket & { id: string };

type Queryable = Pick<Pool, 'query'>;

const requiredValue = (value: string | undefined, name: string): string => {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
};

export const requireProfileMigrationAuthorization = (
  environment: NodeJS.ProcessEnv = process.env,
): ProfileMigrationAuthorization => {
  if (environment.PROFILE_MIGRATION_EXECUTION !== '1') {
    throw new Error('PROFILE_MIGRATION_EXECUTION=1 is required');
  }
  const migrationEnvironment = requiredValue(
    environment.PROFILE_MIGRATION_ENV,
    'PROFILE_MIGRATION_ENV',
  );
  if (migrationEnvironment !== 'candidate' && migrationEnvironment !== 'production') {
    throw new Error('PROFILE_MIGRATION_ENV must be candidate or production');
  }
  const productionLike =
    migrationEnvironment === 'production' ||
    environment.PROFILE_MIGRATION_PRODUCTION_TARGET === '1';
  if (productionLike && environment.PROFILE_MIGRATION_PRODUCTION_APPROVED !== '1') {
    throw new Error('PROFILE_MIGRATION_PRODUCTION_APPROVED=1 is required for production');
  }
  return Object.freeze({
    environment: migrationEnvironment,
    approvalRef: requiredValue(
      environment.PROFILE_MIGRATION_APPROVAL_REF,
      'PROFILE_MIGRATION_APPROVAL_REF',
    ),
  });
};

const names = async (database: Queryable, sql: string, values?: readonly unknown[]) => {
  const [rows] = await database.query<NamedRow[]>(sql, values ? [...values] : undefined);
  return new Set(rows.map((row) => row.name));
};

const count = async (database: Queryable, sql: string, values?: readonly unknown[]) => {
  const [rows] = await database.query<CountRow[]>(sql, values ? [...values] : undefined);
  return Number(rows[0]?.count ?? 0);
};

export const inspectProfileMigrationReadiness = async (
  database: Queryable,
): Promise<ProfileMigrationPreflightReport> => {
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
      missingColumns: [],
      missingConstraints: [],
      invalidConstraints: [],
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

  const existingColumns = await names(
    database,
    `SELECT CONCAT(TABLE_NAME, '.', COLUMN_NAME) AS name
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()`,
  );
  const missingColumns = REQUIRED_COLUMNS
    .map(([table, column]) => `${table}.${column}`)
    .filter((column) => !existingColumns.has(column));
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
  const constraintsByName = new Map(constraintRows.map((row) => [row.name, row]));
  const missingConstraints = REQUIRED_CONSTRAINTS
    .filter((constraint) => !constraintsByName.has(constraint.name))
    .map((constraint) => constraint.name);
  const invalidConstraints = REQUIRED_CONSTRAINTS.flatMap((constraint) => {
    const actual = constraintsByName.get(constraint.name);
    if (!actual) return [];
    return actual.tableName === constraint.table &&
      actual.columnName === constraint.column &&
      actual.referencedTableName === constraint.referencedTable &&
      actual.referencedColumnName === constraint.referencedColumn &&
      actual.deleteRule === constraint.deleteRule
      ? []
      : [constraint.name];
  });
  const [batchRows] = await database.query<BatchRow[]>(
    `SELECT id
     FROM convex_exit_migration_batches
     WHERE domain = 'profiles' AND status = 'running'
     ORDER BY startedAt ASC`,
  );
  const [
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
       FROM profile_asset_snapshots asset
       INNER JOIN profile_snapshots profile ON profile.id = asset.profileId
       LEFT JOIN candidate_fixture_retention_records retained
         ON retained.domain = 'profiles' AND retained.legacyConvexId = profile.legacyConvexId
       WHERE asset.status IN ('pending', 'processing') AND retained.id IS NULL`,
    ),
    count(
      database,
      `SELECT COUNT(*) AS count
       FROM profile_asset_snapshots asset
       INNER JOIN profile_snapshots profile ON profile.id = asset.profileId
       LEFT JOIN candidate_fixture_retention_records retained
         ON retained.domain = 'profiles' AND retained.legacyConvexId = profile.legacyConvexId
       WHERE asset.status = 'failed' AND retained.id IS NULL`,
    ),
    count(
      database,
      `SELECT COUNT(*) AS count
       FROM profile_asset_snapshots asset
       INNER JOIN profile_snapshots profile ON profile.id = asset.profileId
       INNER JOIN candidate_fixture_retention_records retained
         ON retained.domain = 'profiles' AND retained.legacyConvexId = profile.legacyConvexId
       WHERE asset.status IN ('pending', 'processing')`,
    ),
    count(
      database,
      `SELECT COUNT(*) AS count
       FROM profile_asset_snapshots asset
       INNER JOIN profile_snapshots profile ON profile.id = asset.profileId
       INNER JOIN candidate_fixture_retention_records retained
         ON retained.domain = 'profiles' AND retained.legacyConvexId = profile.legacyConvexId
       WHERE asset.status = 'failed'`,
    ),
    count(
      database,
      `SELECT COUNT(*) AS count
       FROM convex_exit_reconciliation_records
       WHERE domain = 'profiles' AND resolvedAt IS NULL
         AND classification <> 'expected_retired_fixture'`,
    ),
    count(
      database,
      `SELECT COUNT(*) AS count
       FROM convex_exit_reconciliation_records
       WHERE domain = 'profiles' AND classification = 'unclassified' AND resolvedAt IS NULL`,
    ),
    count(
      database,
      `SELECT COUNT(*) AS count
       FROM convex_exit_reconciliation_records
       WHERE domain = 'profiles' AND classification = 'expected_retired_fixture' AND resolvedAt IS NULL`,
    ),
  ]);
  const ready =
    missingColumns.length === 0 &&
    missingConstraints.length === 0 &&
    invalidConstraints.length === 0;
  return {
    ready,
    candidateReady:
      ready &&
      batchRows.length === 0 &&
      pendingAssets === 0 &&
      failedAssets === 0 &&
      unresolvedDifferences === 0,
    missingTables,
    missingColumns,
    missingConstraints,
    invalidConstraints,
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