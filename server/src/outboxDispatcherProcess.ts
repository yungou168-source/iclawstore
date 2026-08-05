import { createPool } from 'mysql2/promise';
import { dispatchAvailableOutboxEvents } from './services/outboxDispatcher.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.startsWith('mysql')) {
  throw new Error('DATABASE_URL must be a MySQL URL');
}

const readPositiveInteger = (value: string | undefined, fallback: number, max: number): number => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
};
const pollIntervalMs = readPositiveInteger(process.env.OUTBOX_POLL_INTERVAL_MS, 1000, 60_000);
const batchSize = readPositiveInteger(process.env.OUTBOX_BATCH_SIZE, 20, 100);
const pool = createPool({
  uri: databaseUrl,
  connectionLimit: 2,
  waitForConnections: true,
  enableKeepAlive: true,
});
let stopping = false;

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const stop = () => {
  stopping = true;
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

try {
  while (!stopping) {
    try {
      const result = await dispatchAvailableOutboxEvents(pool, batchSize);
      if (result.processed > 0) {
        console.info(
          JSON.stringify({
            event: 'outbox.dispatch.completed',
            ...result,
          }),
        );
      }
      await sleep(result.processed === batchSize ? 100 : pollIntervalMs);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'outbox.dispatch.failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
      );
      await sleep(Math.max(pollIntervalMs, 5000));
    }
  }
} finally {
  await pool.end();
}