import { hostname } from 'node:os';
import { createPool } from 'mysql2/promise';
import { runNextAuditExport } from './services/auditExportWorker.js';
import {
  createRuntimeObserver,
  parseBoundedPositiveInteger,
  startRuntimeMetricsLogging,
} from './services/runtimeObservability.js';

if (process.env.AUDIT_EXPORT_ENABLED !== 'true') {
  console.info(JSON.stringify({ event: 'audit.export.worker.disabled' }));
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.startsWith('mysql')) throw new Error('DATABASE_URL must be a MySQL URL');

const pollIntervalMs = parseBoundedPositiveInteger(process.env.AUDIT_EXPORT_POLL_INTERVAL_MS, 5_000, 60_000);
const metricsIntervalMs = parseBoundedPositiveInteger(process.env.RUNTIME_METRICS_INTERVAL_MS, 60_000, 300_000);
const workerId = (process.env.AUDIT_EXPORT_WORKER_ID || `${hostname()}:${process.pid}`).slice(0, 128);
const pool = createPool({
  uri: databaseUrl,
  connectionLimit: 1,
  waitForConnections: true,
  enableKeepAlive: true,
});
const observer = createRuntimeObserver({ role: 'audit-export', mysqlConnectionLimit: 1 });
const stopMetricsLogging = startRuntimeMetricsLogging(
  observer,
  (metrics) => console.info(JSON.stringify({ event: 'runtime.metrics', ...metrics })),
  metricsIntervalMs,
);
let stopping = false;
const stop = () => { stopping = true; };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

console.info(JSON.stringify({ event: 'audit.export.worker.started', workerId, concurrency: 1 }));
try {
  while (!stopping) {
    const result = await runNextAuditExport(pool, workerId);
    if (result.kind !== 'idle') console.info(JSON.stringify({ event: `audit.export.${result.kind}`, ...result }));
    await sleep(result.kind === 'idle' ? pollIntervalMs : 100);
  }
} catch (error) {
  console.error(JSON.stringify({
    event: 'audit.export.worker.failed',
    error: error instanceof Error ? error.message : 'Unknown error',
  }));
  process.exitCode = 1;
} finally {
  stopMetricsLogging();
  observer.close();
  await pool.end();
  console.info(JSON.stringify({ event: 'audit.export.worker.stopped' }));
}