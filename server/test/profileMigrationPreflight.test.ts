import { describe, expect, it, vi } from 'bun:test';
import {
  inspectProfileMigrationReadiness,
  requireProfileMigrationAuthorization,
} from '../src/domains/profiles/profileMigrationPreflight.js';

const tables = [
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
].map((name) => ({ name }));

const columns = [
  'convex_exit_reconciliation_records.classification',
  'convex_exit_reconciliation_records.resolvedAt',
  'convex_exit_outbox_events.claimedAt',
  'convex_exit_outbox_events.leaseExpiresAt',
  'profile_asset_snapshots.targetAssetId',
].map((name) => ({ name }));

const constraints = [
  {
    name: 'profile_identity_alias_profile_fk',
    tableName: 'profile_identity_aliases',
    columnName: 'profileId',
    referencedTableName: 'profile_snapshots',
    referencedColumnName: 'id',
    deleteRule: 'CASCADE',
  },
  {
    name: 'profile_asset_snapshots_profile_fk',
    tableName: 'profile_asset_snapshots',
    columnName: 'profileId',
    referencedTableName: 'profile_snapshots',
    referencedColumnName: 'id',
    deleteRule: 'CASCADE',
  },
  {
    name: 'profile_sync_checkpoints_batch_fk',
    tableName: 'profile_sync_checkpoints',
    columnName: 'batchId',
    referencedTableName: 'convex_exit_migration_batches',
    referencedColumnName: 'id',
    deleteRule: 'CASCADE',
  },
  {
    name: 'profile_asset_snapshots_target_asset_fk',
    tableName: 'profile_asset_snapshots',
    columnName: 'targetAssetId',
    referencedTableName: 'convex_exit_managed_assets',
    referencedColumnName: 'id',
    deleteRule: 'SET NULL',
  },
  {
    name: 'convex_exit_reconciliation_batch_fk',
    tableName: 'convex_exit_reconciliation_records',
    columnName: 'batchId',
    referencedTableName: 'convex_exit_migration_batches',
    referencedColumnName: 'id',
    deleteRule: 'SET NULL',
  },
];

const database = (overrides: Readonly<{
  tables?: unknown[];
  columns?: unknown[];
  constraints?: unknown[];
  batches?: unknown[];
  pending?: number;
  failed?: number;
  unresolved?: number;
  unclassified?: number;
}> = {}) => {
  const query = vi.fn(async (sql: string) => {
    expect(sql.trimStart().startsWith('SELECT')).toBe(true);
    if (sql.includes('information_schema.TABLES')) return [overrides.tables ?? tables, []];
    if (sql.includes('information_schema.COLUMNS')) return [overrides.columns ?? columns, []];
    if (sql.includes('REFERENTIAL_CONSTRAINTS')) return [overrides.constraints ?? constraints, []];
    if (sql.includes('convex_exit_migration_batches')) return [overrides.batches ?? [], []];
    if (sql.includes("status IN ('pending', 'processing')")) {
      return [[{ count: overrides.pending ?? 0 }], []];
    }
    if (sql.includes("status = 'failed'")) return [[{ count: overrides.failed ?? 0 }], []];
    if (sql.includes("classification = 'unclassified'")) {
      return [[{ count: overrides.unclassified ?? 0 }], []];
    }
    if (sql.includes('convex_exit_reconciliation_records')) {
      return [[{ count: overrides.unresolved ?? 0 }], []];
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  return { query };
};

describe('Profile migration preflight', () => {
  it('requires explicit execution environment and approval', () => {
    expect(() => requireProfileMigrationAuthorization({})).toThrow(
      'PROFILE_MIGRATION_EXECUTION=1 is required',
    );
    expect(() => requireProfileMigrationAuthorization({
      PROFILE_MIGRATION_EXECUTION: '1',
      PROFILE_MIGRATION_ENV: 'candidate',
    })).toThrow('PROFILE_MIGRATION_APPROVAL_REF is required');
  });

  it('requires a separate production approval bit', () => {
    const environment = {
      PROFILE_MIGRATION_EXECUTION: '1',
      PROFILE_MIGRATION_ENV: 'production',
      PROFILE_MIGRATION_APPROVAL_REF: 'change-123',
    };
    expect(() => requireProfileMigrationAuthorization(environment)).toThrow(
      'PROFILE_MIGRATION_PRODUCTION_APPROVED=1 is required for production',
    );
    expect(requireProfileMigrationAuthorization({
      PROFILE_MIGRATION_EXECUTION: '1',
      PROFILE_MIGRATION_ENV: 'candidate',
      PROFILE_MIGRATION_APPROVAL_REF: 'change-123',
      NODE_ENV: 'production',
    })).toEqual({ environment: 'candidate', approvalRef: 'change-123' });
    expect(requireProfileMigrationAuthorization({
      ...environment,
      PROFILE_MIGRATION_PRODUCTION_APPROVED: '1',
    })).toEqual({ environment: 'production', approvalRef: 'change-123' });
  });

  it('rejects missing columns and incorrectly wired foreign keys', async () => {
    const invalidConstraint = {
      ...constraints[3],
      referencedTableName: 'wrong_assets',
    };
    const db = database({
      columns: columns.slice(0, -1),
      constraints: [...constraints.slice(0, 3), invalidConstraint, constraints[4]],
    });
    const report = await inspectProfileMigrationReadiness(db as never);

    expect(report.ready).toBe(false);
    expect(report.missingColumns).toEqual(['profile_asset_snapshots.targetAssetId']);
    expect(report.invalidConstraints).toEqual(['profile_asset_snapshots_target_asset_fk']);
  });

  it('keeps structural readiness separate from candidate backlog readiness and remains read-only', async () => {
    const db = database({
      batches: [{ id: 'batch-running' }],
      pending: 2,
      failed: 1,
      unresolved: 4,
      unclassified: 3,
    });
    const report = await inspectProfileMigrationReadiness(db as never);

    expect(report).toMatchObject({
      ready: true,
      candidateReady: false,
      runningBatchIds: ['batch-running'],
      pendingAssets: 2,
      failedAssets: 1,
      unresolvedDifferences: 4,
      unclassifiedDifferences: 3,
    });
    expect(db.query).toHaveBeenCalledTimes(11);
  });
});