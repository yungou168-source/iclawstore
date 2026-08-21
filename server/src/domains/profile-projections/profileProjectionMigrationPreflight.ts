import type { Pool, RowDataPacket } from 'mysql2/promise';

const REQUIRED_TABLES = [
  'profile_catalog_items',
  'profile_starred_items',
  'profile_catalog_manifests',
  'profile_catalog_manifest_sections',
  'profile_projection_reconciliation_checkpoints',
  'profile_projection_reconciliation_reports',
  'convex_exit_migration_batches',
  'convex_exit_legacy_id_maps',
  'convex_exit_reconciliation_records',
  'convex_exit_outbox_events',
] as const;

const REQUIRED_CONSTRAINTS = [
  'profile_catalog_items_publisher_fk',
  'profile_starred_items_viewer_profile_fk',
  'profile_catalog_manifests_publisher_fk',
  'profile_catalog_manifest_sections_manifest_fk',
  'profile_catalog_manifest_entries_section_fk',
  'profile_catalog_manifest_entries_catalog_item_fk',
] as const;

type Queryable = Pick<Pool, 'query'>;
type NamedRow = RowDataPacket & { name: string };
type CountRow = RowDataPacket & { count: number | bigint };
type BatchRow = RowDataPacket & { id: string };

export type ProfileProjectionMigrationPreflightReport = Readonly<{
  ready: boolean;
  candidateReady: boolean;
  missingTables: readonly string[];
  missingConstraints: readonly string[];
  missingProfileMaps: number;
  missingPublisherMaps: number;
  runningBatchIds: readonly string[];
  failedBatchIds: readonly string[];
  unresolvedDifferences: number;
  unclassifiedDifferences: number;
  completedCandidateReadyReconciliations: number;
}>;

const count = async (database: Queryable, sql: string, values?: readonly unknown[]): Promise<number> => {
  const [rows] = await database.query<CountRow[]>(sql, values ? [...values] : undefined);
  return Number(rows[0]?.count ?? 0);
};

export const inspectProfileProjectionMigrationReadiness = async (
  database: Queryable,
): Promise<ProfileProjectionMigrationPreflightReport> => {
  const [tableRows] = await database.query<NamedRow[]>(
    'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()',
  );
  const tables = new Set(tableRows.map((row) => row.name));
  const missingTables = REQUIRED_TABLES.filter((table) => !tables.has(table));
  if (missingTables.length > 0) {
    return { ready: false, candidateReady: false, missingTables, missingConstraints: [], missingProfileMaps: 0, missingPublisherMaps: 0, runningBatchIds: [], failedBatchIds: [], unresolvedDifferences: 0, unclassifiedDifferences: 0, completedCandidateReadyReconciliations: 0 };
  }
  const [constraintRows] = await database.query<NamedRow[]>(
    'SELECT CONSTRAINT_NAME AS name FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()',
  );
  const constraints = new Set(constraintRows.map((row) => row.name));
  const missingConstraints = REQUIRED_CONSTRAINTS.filter((name) => !constraints.has(name));
  const [runningRows, failedRows] = await Promise.all([
    database.query<BatchRow[]>("SELECT id FROM convex_exit_migration_batches WHERE domain = 'profile_projections' AND status = 'running' ORDER BY startedAt ASC"),
    database.query<BatchRow[]>("SELECT id FROM convex_exit_migration_batches WHERE domain = 'profile_projections' AND status = 'failed' ORDER BY failedAt ASC"),
  ]);
  const [missingProfileMaps, missingPublisherMaps, unresolvedDifferences, unclassifiedDifferences, completedCandidateReadyReconciliations] = await Promise.all([
    count(database, "SELECT COUNT(*) AS count FROM profile_starred_items item LEFT JOIN convex_exit_legacy_id_maps map ON map.domain = 'profiles' AND map.targetId = item.viewerProfileId WHERE map.targetId IS NULL"),
    count(database, "SELECT COUNT(*) AS count FROM profile_catalog_items item LEFT JOIN convex_exit_legacy_id_maps map ON map.domain = 'publishers' AND map.targetId = item.publisherId WHERE map.targetId IS NULL"),
    count(database, "SELECT COUNT(*) AS count FROM convex_exit_reconciliation_records WHERE domain = 'profile_projections' AND resolvedAt IS NULL"),
    count(database, "SELECT COUNT(*) AS count FROM convex_exit_reconciliation_records WHERE domain = 'profile_projections' AND classification = 'unclassified' AND resolvedAt IS NULL"),
    count(database, 'SELECT COUNT(*) AS count FROM profile_projection_reconciliation_reports WHERE candidateReady = 1'),
  ]);
  const runningBatchIds = runningRows[0].map((row) => row.id);
  const failedBatchIds = failedRows[0].map((row) => row.id);
  const ready = missingConstraints.length === 0 && missingProfileMaps === 0 && missingPublisherMaps === 0 && runningBatchIds.length === 0;
  return { ready, candidateReady: ready && failedBatchIds.length === 0 && unresolvedDifferences === 0 && unclassifiedDifferences === 0 && completedCandidateReadyReconciliations > 0, missingTables, missingConstraints, missingProfileMaps, missingPublisherMaps, runningBatchIds, failedBatchIds, unresolvedDifferences, unclassifiedDifferences, completedCandidateReadyReconciliations };
};