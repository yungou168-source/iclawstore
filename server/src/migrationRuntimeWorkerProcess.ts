import { createPool } from 'mysql2/promise';
import { createMysqlRuntimeStore } from './domains/runtime/mysqlRuntimeStore.js';
import type { SoulRuntimeJobKind } from './domains/souls/soulRuntimeJobs.js';
import { createSoulRuntimeComposition } from './domains/souls/soulRuntimeComposition.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.startsWith('mysql')) throw new Error('DATABASE_URL must be a MySQL URL');
const selectedKind = process.env.SOUL_RUNTIME_JOB as SoulRuntimeJobKind | undefined;
if (!selectedKind) throw new Error('SOUL_RUNTIME_JOB is required');
const validKinds: readonly SoulRuntimeJobKind[] = ['soul-full-import', 'soul-incremental-sync', 'soul-asset-copy', 'soul-reconcile'];
if (!validKinds.includes(selectedKind)) throw new Error(`SOUL_RUNTIME_JOB is invalid: ${selectedKind}`);
const pool = createPool({ uri: databaseUrl, connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT ?? 4) });
const runtime = createSoulRuntimeComposition({ pool });
const store = createMysqlRuntimeStore(pool);
const workerName = process.env.WORKER_NAME ?? 'migration-runtime';
const ownerId = `${workerName}:${process.pid}`;
const intervalMs = Math.max(5_000, Number(process.env.WORKER_INTERVAL_MS ?? 30_000));

const run = async (): Promise<void> => {
  const lease = await store.acquire(workerName, ownerId, intervalMs * 2);
  if (!lease) return;
  try {
    const result = await runtime.registry.run(selectedKind);
    const renewed = await store.renew(workerName, lease, intervalMs * 2);
    if (!renewed) return;
    await store.checkpoint(workerName, result.cursor, result.watermark, result.completed);
  } finally { await store.release(workerName, lease); }
};

const timer = setInterval(() => { void run().catch((error: unknown) => console.error('runtime worker failed', error)); }, intervalMs);
await run();
const stop = async (): Promise<void> => { clearInterval(timer); await pool.end(); process.exit(0); };
process.once('SIGTERM', () => { void stop(); });
process.once('SIGINT', () => { void stop(); });