import { randomUUID } from "node:crypto";
import { createPool } from "mysql2/promise";
import { createConvexPublisherMigrationSource } from "./domains/publishers/convexPublisherMigrationSource.js";
import {
  inspectPublisherMigrationReadiness,
  requirePublisherMigrationAuthorization,
} from "./domains/publishers/publisherMigrationPreflight.js";
import {
  publisherBatchSize,
  requirePublisherMysqlDatabaseUrl,
} from "./domains/publishers/publisherMigrationRuntime.js";
import {
  runPublisherSyncPage,
  runPublisherSyncToCompletion,
} from "./domains/publishers/publisherSyncOrchestrator.js";
import { createAuthorizedProfileConvexClient } from "./profileBackfillProcess.js";

export const createAuthorizedPublisherConvexClient = (
  environment: NodeJS.ProcessEnv = process.env,
) =>
  createAuthorizedProfileConvexClient({
    ...environment,
    PROFILE_MIGRATION_CONVEX_ADMIN_KEY:
      environment.PUBLISHER_MIGRATION_CONVEX_ADMIN_KEY ?? environment.CONVEX_SELF_HOSTED_ADMIN_KEY,
  });

export const runPublisherSyncProcess = async (
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> => {
  const authorization = requirePublisherMigrationAuthorization(environment);
  const pool = createPool({
    uri: requirePublisherMysqlDatabaseUrl(environment),
    connectionLimit: 2,
    waitForConnections: true,
    enableKeepAlive: true,
  });
  try {
    const readiness = await inspectPublisherMigrationReadiness(pool);
    if (!readiness.ready) {
      throw new Error("Publisher migration schema preflight is not ready");
    }
    const convex = createAuthorizedPublisherConvexClient(environment);
    const source = createConvexPublisherMigrationSource({
      query: (reference, args) => convex.query(reference, args),
    });
    const input = {
      pool,
      source,
      batchId: environment.PUBLISHER_MIGRATION_BATCH_ID?.trim() || randomUUID(),
      batchSize: publisherBatchSize(environment.PUBLISHER_MIGRATION_BATCH_SIZE),
      approvalRef: authorization.approvalRef,
      requestedBy: environment.PUBLISHER_MIGRATION_REQUESTED_BY,
    };
    const result =
      environment.PUBLISHER_MIGRATION_RUN_TO_COMPLETION === "1"
        ? await runPublisherSyncToCompletion(input)
        : await runPublisherSyncPage(input);
    console.info(
      JSON.stringify({
        event: "publisher.migration.sync.completed",
        environment: authorization.environment,
        approvalRef: authorization.approvalRef,
        ...result,
      }),
    );
  } finally {
    await pool.end();
  }
};

if (process.argv[1] && /(?:^|\/)publisherSyncProcess(?:\.ts|\.js)?$/.test(process.argv[1])) {
  await runPublisherSyncProcess();
}
