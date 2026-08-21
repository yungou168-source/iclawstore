import { hostname } from "node:os";
import { createPool } from "mysql2/promise";
import { createConvexPublisherAvatarSourceReader } from "./domains/publishers/convexPublisherAvatarSourceReader.js";
import { createMysqlPublisherAvatarAssetRepository } from "./domains/publishers/mysqlPublisherAvatarAssetRepository.js";
import { createPublisherAvatarAssetConsumer } from "./domains/publishers/publisherAvatarAssetConsumer.js";
import { createPublisherAvatarAssetImporter } from "./domains/publishers/publisherAvatarAssetImport.js";
import {
  authorizeAndPreflightPublisherProcess,
  boundedPublisherInteger,
  installPublisherProcessShutdown,
  publisherProcessMode,
  requirePublisherMysqlDatabaseUrl,
  sleep,
} from "./domains/publishers/publisherMigrationRuntime.js";
import { createAuthorizedPublisherConvexClient } from "./publisherSyncProcess.js";
import { ManagedAssetStore } from "./services/managedAssetStore.js";

export const runPublisherAvatarAssetConsumerProcess = async (
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> => {
  const mode = publisherProcessMode(environment.PUBLISHER_PROCESS_MODE);
  const concurrency = boundedPublisherInteger(
    environment.PUBLISHER_AVATAR_CONCURRENCY,
    "PUBLISHER_AVATAR_CONCURRENCY",
    1,
    1,
    8,
  );
  const batchSize = boundedPublisherInteger(
    environment.PUBLISHER_AVATAR_BATCH_SIZE,
    "PUBLISHER_AVATAR_BATCH_SIZE",
    25,
    1,
    250,
  );
  const pollIntervalMs = boundedPublisherInteger(
    environment.PUBLISHER_AVATAR_POLL_INTERVAL_MS,
    "PUBLISHER_AVATAR_POLL_INTERVAL_MS",
    5_000,
    100,
    300_000,
  );
  const pool = createPool({
    uri: requirePublisherMysqlDatabaseUrl(environment),
    connectionLimit: Math.max(2, concurrency + 1),
    waitForConnections: true,
    enableKeepAlive: true,
  });
  const shutdown = installPublisherProcessShutdown();

  try {
    const { authorization, report } = await authorizeAndPreflightPublisherProcess(
      pool,
      environment,
    );
    const store = ManagedAssetStore.fromEnvironment(environment);
    await store.initialize();
    const convex = createAuthorizedPublisherConvexClient(environment);
    const consumer = createPublisherAvatarAssetConsumer({
      pool,
      sourceReader: createConvexPublisherAvatarSourceReader({
        query: (reference, args) => convex.query(reference, args),
      }),
      importer: createPublisherAvatarAssetImporter(
        store,
        createMysqlPublisherAvatarAssetRepository(pool),
      ),
    });
    const workerId = `${hostname()}:${process.pid}`;
    console.info(
      JSON.stringify({
        event: "publisher.avatar.consumer.started",
        workerId,
        mode,
        concurrency,
        batchSize,
        environment: authorization.environment,
        approvalRef: authorization.approvalRef,
        pendingAssets: report.pendingAssets,
        failedAssets: report.failedAssets,
      }),
    );

    do {
      let attempted = 0;
      let imported = 0;
      let failed = 0;
      let idle = false;
      while (!shutdown.isStopping() && attempted < batchSize && !idle) {
        const width = Math.min(concurrency, batchSize - attempted);
        const results = await Promise.all(
          Array.from({ length: width }, () => consumer.consumeNext()),
        );
        attempted += results.filter((result) => result.kind !== "idle").length;
        imported += results.filter((result) => result.kind === "imported").length;
        failed += results.filter((result) => result.kind === "failed").length;
        idle = results.some((result) => result.kind === "idle");
      }
      console.info(
        JSON.stringify({
          event: "publisher.avatar.consumer.cycle.completed",
          workerId,
          attempted,
          imported,
          failed,
          idle,
        }),
      );
      if (mode === "once" || shutdown.isStopping()) break;
      await sleep(idle ? pollIntervalMs : 100);
    } while (!shutdown.isStopping());
  } finally {
    shutdown.dispose();
    await pool.end();
  }
};

if (
  process.argv[1] &&
  /(?:^|\/)publisherAvatarAssetConsumerProcess(?:\.ts|\.js)?$/.test(process.argv[1])
) {
  await runPublisherAvatarAssetConsumerProcess();
}
