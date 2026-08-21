import { createPool } from "mysql2/promise";
import { inspectPublisherCutoverReadiness } from "./domains/publishers/publisherCutoverReadiness.js";
import { requirePublisherMysqlDatabaseUrl } from "./domains/publishers/publisherMigrationRuntime.js";

export const runPublisherCutoverReadinessProcess = async (
  environment: NodeJS.ProcessEnv = process.env,
) => {
  const pool = createPool({
    uri: requirePublisherMysqlDatabaseUrl(environment),
    connectionLimit: 2,
  });
  try {
    const report = await inspectPublisherCutoverReadiness(pool, environment);
    console.info(JSON.stringify({ domain: "publishers", report }, null, 2));
    if (!report.ready) process.exitCode = 1;
    return report;
  } finally {
    await pool.end();
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  runPublisherCutoverReadinessProcess().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
