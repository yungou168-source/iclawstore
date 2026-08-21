import { createPool } from "mysql2/promise";
import {
  inspectPublisherMigrationReadiness,
  requirePublisherMigrationAuthorization,
} from "./domains/publishers/publisherMigrationPreflight.js";
import { requirePublisherMysqlDatabaseUrl } from "./domains/publishers/publisherMigrationRuntime.js";

export const runPublisherMigrationPreflightProcess = async (
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> => {
  const authorization = requirePublisherMigrationAuthorization(environment);
  const databaseUrl = requirePublisherMysqlDatabaseUrl(environment);
  const pool = createPool({
    uri: databaseUrl,
    connectionLimit: 1,
    waitForConnections: true,
    enableKeepAlive: true,
  });
  try {
    const report = await inspectPublisherMigrationReadiness(pool);
    console.info(
      JSON.stringify({
        event: "publisher.migration.preflight.completed",
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

if (
  process.argv[1] &&
  /(?:^|\/)publisherMigrationPreflightProcess(?:\.ts|\.js)?$/.test(process.argv[1])
) {
  await runPublisherMigrationPreflightProcess();
}
