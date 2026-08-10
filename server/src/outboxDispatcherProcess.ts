import { createPool } from "mysql2/promise";
import { dispatchAvailableOutboxEvents } from "./services/outboxDispatcher.js";
import {
  createRuntimeObserver,
  parseBoundedPositiveInteger,
  startRuntimeMetricsLogging,
} from "./services/runtimeObservability.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.startsWith("mysql")) {
  throw new Error("DATABASE_URL must be a MySQL URL");
}

const pollIntervalMs = parseBoundedPositiveInteger(
  process.env.OUTBOX_POLL_INTERVAL_MS,
  1000,
  60_000,
);
const batchSize = parseBoundedPositiveInteger(process.env.OUTBOX_BATCH_SIZE, 20, 20);
const metricsIntervalMs = parseBoundedPositiveInteger(
  process.env.RUNTIME_METRICS_INTERVAL_MS,
  60_000,
  300_000,
);
const pool = createPool({
  uri: databaseUrl,
  connectionLimit: 2,
  waitForConnections: true,
  enableKeepAlive: true,
});
const observer = createRuntimeObserver({ role: "dispatcher", mysqlConnectionLimit: 2 });
const stopMetricsLogging = startRuntimeMetricsLogging(
  observer,
  (metrics) => console.info(JSON.stringify({ event: "runtime.metrics", ...metrics })),
  metricsIntervalMs,
);
let stopping = false;

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const stop = () => {
  stopping = true;
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

try {
  while (!stopping) {
    try {
      const result = await dispatchAvailableOutboxEvents(pool, batchSize);
      if (result.processed > 0) {
        console.info(
          JSON.stringify({
            event: "outbox.dispatch.completed",
            ...result,
          }),
        );
      }
      await sleep(result.processed === batchSize ? 100 : pollIntervalMs);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "outbox.dispatch.failed",
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      );
      await sleep(Math.max(pollIntervalMs, 5000));
    }
  }
} finally {
  stopMetricsLogging();
  observer.close();
  await pool.end();
}
