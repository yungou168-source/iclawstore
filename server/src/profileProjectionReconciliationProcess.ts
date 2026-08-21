import { randomUUID } from 'node:crypto';
import { createPool } from 'mysql2/promise';
import { createMigrationPort } from './domains/migration/migrationPort.js';
import { createConvexProfileProjectionSource } from './domains/profile-projections/convexProfileProjectionMigrationSource.js';
import {
  profileProjectionBatchSize,
  requireProfileProjectionMigrationAuthorization,
  requireProfileProjectionMysqlDatabaseUrl,
} from './domains/profile-projections/profileProjectionMigrationRuntime.js';
import { createProfileProjectionOrphanRepository } from './domains/profile-projections/profileProjectionOrphanRepository.js';
import { createProfileProjectionReconciliationCheckpointRepository } from './domains/profile-projections/profileProjectionReconciliationCheckpointRepository.js';
import { createProfileProjectionReconciliationReportRepository } from './domains/profile-projections/profileProjectionReconciliationReportRepository.js';
import { runProfileProjectionReconciliationToCompletion } from './domains/profile-projections/profileProjectionReconciliationRunner.js';
import { createProfileProjectionReconciliationTarget } from './domains/profile-projections/profileProjectionReconciliationTargetRepository.js';
import { unclassifiedProfileProjectionDifference } from './domains/profile-projections/profileProjectionReconciliationClassification.js';
import { inspectProfileProjectionMigrationReadiness } from './domains/profile-projections/profileProjectionMigrationPreflight.js';
import { createAuthorizedProfileProjectionConvexClient } from './profileProjectionSyncProcess.js';

export const runProfileProjectionReconciliationProcess = async (
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> => {
  const authorization = requireProfileProjectionMigrationAuthorization(environment);
  const pool = createPool({ uri: requireProfileProjectionMysqlDatabaseUrl(environment), connectionLimit: 2, waitForConnections: true });
  const batchId = environment.PROFILE_PROJECTION_RECONCILIATION_BATCH_ID?.trim() || randomUUID();
  try {
    const readiness = await inspectProfileProjectionMigrationReadiness(pool);
    if (!readiness.ready) throw new Error('Profile projection reconciliation preflight is not ready');
    const migration = createMigrationPort({ query: (sql, values) => pool.query(sql, values ? [...values] : undefined) });
    await migration.startBatch({
      id: batchId,
      domain: 'profile_projections',
      source: 'convex-profile-projection-reconciliation',
      approvalRef: authorization.approvalRef,
      requestedBy: environment.PROFILE_PROJECTION_MIGRATION_REQUESTED_BY?.trim() || undefined,
    });
    const state = await migration.loadBatchState(batchId);
    if (state?.status === 'completed') throw new Error('Completed profile projection reconciliation batch cannot be reopened');
    const convex = createAuthorizedProfileProjectionConvexClient(environment);
    const source = createConvexProfileProjectionSource({ query: (reference, args) => convex.query(reference, args) });
    const checkpoint = createProfileProjectionReconciliationCheckpointRepository({
      query: (sql, values) => pool.query(sql, values ? [...values] : undefined),
    });
    const target = createProfileProjectionReconciliationTarget({
      query: (sql, values) => pool.query(sql, values ? [...values] : undefined),
    });
    const result = await runProfileProjectionReconciliationToCompletion({
      batchId,
      source,
      target: (phase, items) => target.list(phase, items),
      checkpoint,
      batchSize: profileProjectionBatchSize(environment.PROFILE_PROJECTION_RECONCILIATION_BATCH_SIZE),
      sink: { record: (difference) => migration.recordDifference(unclassifiedProfileProjectionDifference(difference)) },
    });
    for (const difference of await createProfileProjectionOrphanRepository({
      query: (sql, values) => pool.query(sql, values ? [...values] : undefined),
    }).list()) {
      await migration.recordDifference(unclassifiedProfileProjectionDifference({ ...difference, batchId }));
    }
    await migration.persistProgress(batchId, {
      cursor: null,
      sourceCount: BigInt(result.sourceCount),
      upsertedCount: 0n,
      unchangedCount: BigInt(result.sourceCount),
      errorCount: 0n,
      completed: true,
    });
    const report = await createProfileProjectionReconciliationReportRepository({
      query: (sql, values) => pool.query(sql, values ? [...values] : undefined),
    }).persist(batchId);
    console.info(JSON.stringify({ event: 'profile-projections.reconciliation.completed', environment: authorization.environment, approvalRef: authorization.approvalRef, ...report }));
  } catch (error) {
    await createMigrationPort({ query: (sql, values) => pool.query(sql, values ? [...values] : undefined) })
      .recordFailure(batchId, 'profile_projection_reconciliation_failed');
    throw error;
  } finally {
    await pool.end();
  }
};

if (process.argv[1] && /(?:^|\/)profileProjectionReconciliationProcess(?:\.ts|\.js)?$/.test(process.argv[1])) {
  await runProfileProjectionReconciliationProcess();
}