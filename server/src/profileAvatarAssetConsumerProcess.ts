import { hostname } from 'node:os';
import { createPool } from 'mysql2/promise';
import { createProfileAvatarAssetImporter } from './domains/profiles/profileAvatarAssetImport.js';
import { createProfileAvatarAssetConsumer } from './domains/profiles/profileAvatarAssetConsumer.js';
import { createConvexProfileAvatarSourceReader } from './domains/profiles/convexProfileAvatarSourceReader.js';
import { createMysqlProfileAvatarAssetRepository } from './domains/profiles/mysqlProfileAvatarAssetRepository.js';
import {
  authorizeAndPreflightProfileProcess,
  boundedProfileInteger,
  installProfileProcessShutdown,
  profileProcessMode,
  requireMysqlDatabaseUrl,
  sleep,
} from './domains/profiles/profileMigrationRuntime.js';
import { createAuthorizedProfileConvexClient } from './profileBackfillProcess.js';
import { ManagedAssetStore } from './services/managedAssetStore.js';

export const runProfileAvatarAssetConsumerProcess = async (
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> => {
  const mode = profileProcessMode(environment.PROFILE_PROCESS_MODE);
  const databaseUrl = requireMysqlDatabaseUrl(environment);
  const concurrency = boundedProfileInteger(
    environment.PROFILE_AVATAR_CONCURRENCY,
    'PROFILE_AVATAR_CONCURRENCY',
    1,
    1,
    8,
  );
  const batchSize = boundedProfileInteger(
    environment.PROFILE_AVATAR_BATCH_SIZE,
    'PROFILE_AVATAR_BATCH_SIZE',
    25,
    1,
    250,
  );
  const pollIntervalMs = boundedProfileInteger(
    environment.PROFILE_AVATAR_POLL_INTERVAL_MS,
    'PROFILE_AVATAR_POLL_INTERVAL_MS',
    5_000,
    100,
    300_000,
  );
  const pool = createPool({
    uri: databaseUrl,
    connectionLimit: Math.max(2, concurrency + 1),
    waitForConnections: true,
    enableKeepAlive: true,
  });
  const shutdown = installProfileProcessShutdown();

  try {
    const { authorization, report } = await authorizeAndPreflightProfileProcess(pool, environment);
    const store = ManagedAssetStore.fromEnvironment(environment);
    await store.initialize();
    const repository = createMysqlProfileAvatarAssetRepository(pool);
    const convex = createAuthorizedProfileConvexClient(environment);
    const consumer = createProfileAvatarAssetConsumer({
      pool,
      sourceReader: createConvexProfileAvatarSourceReader({
        query: (reference, args) => convex.query(reference, args),
      }),
      importer: createProfileAvatarAssetImporter(store, repository),
    });
    const workerId = `${hostname()}:${process.pid}`;
    console.info(JSON.stringify({
      event: 'profile.avatar.consumer.started',
      workerId,
      mode,
      concurrency,
      batchSize,
      environment: authorization.environment,
      approvalRef: authorization.approvalRef,
      pendingAssets: report.pendingAssets,
      failedAssets: report.failedAssets,
    }));

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
        attempted += results.filter((result) => result.kind !== 'idle').length;
        imported += results.filter((result) => result.kind === 'imported').length;
        failed += results.filter((result) => result.kind === 'failed').length;
        idle = results.some((result) => result.kind === 'idle');
      }
      console.info(JSON.stringify({
        event: 'profile.avatar.consumer.cycle.completed',
        workerId,
        attempted,
        imported,
        failed,
        idle,
      }));
      if (mode === 'once' || shutdown.isStopping()) break;
      await sleep(idle ? pollIntervalMs : 100);
    } while (!shutdown.isStopping());
  } finally {
    shutdown.dispose();
    await pool.end();
  }
};

if (process.argv[1] && /(?:^|\/)profileAvatarAssetConsumerProcess(?:\.ts|\.js)?$/.test(process.argv[1])) {
  await runProfileAvatarAssetConsumerProcess();
}
