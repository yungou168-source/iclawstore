import { createPool } from 'mysql2/promise';
import {
  inspectProfileMigrationReadiness,
  requireProfileMigrationAuthorization,
} from './domains/profiles/profileMigrationPreflight.js';
import { requireMysqlDatabaseUrl } from './domains/profiles/profileMigrationRuntime.js';

export const runProfileMigrationPreflightProcess = async (
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> => {
  const authorization = requireProfileMigrationAuthorization(environment);
  const databaseUrl = requireMysqlDatabaseUrl(environment);
  const pool = createPool({
    uri: databaseUrl,
    connectionLimit: 1,
    waitForConnections: true,
    enableKeepAlive: true,
  });
  try {
    const report = await inspectProfileMigrationReadiness(pool);
    console.info(
      JSON.stringify({
        event: 'profile.migration.preflight.completed',
        environment: authorization.environment,
        approvalRef: authorization.approvalRef,
        ...report,
      }),
    );
    if (!report.ready) process.exitCode = 1;
  } finally {
    await pool.end();
  }
};

if (process.argv[1] && /(?:^|\/)profileMigrationPreflightProcess(?:\.ts|\.js)?$/.test(process.argv[1])) {
  await runProfileMigrationPreflightProcess();
}
