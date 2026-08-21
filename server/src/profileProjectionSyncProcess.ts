import { randomUUID } from 'node:crypto';
import { createPool } from 'mysql2/promise';
import { createConvexProfileProjectionSource } from './domains/profile-projections/convexProfileProjectionMigrationSource.js';
import {
  inspectProfileProjectionMigrationReadiness,
} from './domains/profile-projections/profileProjectionMigrationPreflight.js';
import {
  profileProjectionBatchSize,
  requireProfileProjectionMigrationAuthorization,
  requireProfileProjectionMysqlDatabaseUrl,
  requireProfileProjectionRunToCompletion,
} from './domains/profile-projections/profileProjectionMigrationRuntime.js';
import {
  runProfileProjectionSyncPage,
  runProfileProjectionSyncToCompletion,
} from './domains/profile-projections/profileProjectionSyncOrchestrator.js';
import { createAuthorizedProfileConvexClient } from './profileBackfillProcess.js';

export const createAuthorizedProfileProjectionConvexClient = (
  environment: NodeJS.ProcessEnv = process.env,
) => createAuthorizedProfileConvexClient({
  ...environment,
  PROFILE_MIGRATION_CONVEX_ADMIN_KEY:
    environment.PROFILE_PROJECTION_MIGRATION_CONVEX_ADMIN_KEY ??
    environment.CONVEX_SELF_HOSTED_ADMIN_KEY,
});

export const runProfileProjectionSyncProcess = async (
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> => {
  const authorization = requireProfileProjectionMigrationAuthorization(environment);
  const pool = createPool({
    uri: requireProfileProjectionMysqlDatabaseUrl(environment),
    connectionLimit: 2,
    waitForConnections: true,
    enableKeepAlive: true,
  });
  try {
    const readiness = await inspectProfileProjectionMigrationReadiness(pool);
    if (!readiness.ready) throw new Error('Profile projection migration preflight is not ready');
    const convex = createAuthorizedProfileProjectionConvexClient(environment);
    const source = createConvexProfileProjectionSource({
      query: (reference, args) => convex.query(reference, args),
    });
    const input = {
      pool,
      source,
      batchId: environment.PROFILE_PROJECTION_MIGRATION_BATCH_ID?.trim() || randomUUID(),
      batchSize: profileProjectionBatchSize(environment.PROFILE_PROJECTION_MIGRATION_BATCH_SIZE),
      approvalRef: authorization.approvalRef,
      requestedBy: environment.PROFILE_PROJECTION_MIGRATION_REQUESTED_BY,
    };
    const result = requireProfileProjectionRunToCompletion(environment)
      ? await runProfileProjectionSyncToCompletion(input)
      : await runProfileProjectionSyncPage(input);
    console.info(JSON.stringify({
      event: 'profile-projections.migration.sync.completed',
      environment: authorization.environment,
      approvalRef: authorization.approvalRef,
      ...result,
    }));
  } finally {
    await pool.end();
  }
};

if (process.argv[1] && /(?:^|\/)profileProjectionSyncProcess(?:\.ts|\.js)?$/.test(process.argv[1])) {
  await runProfileProjectionSyncProcess();
}