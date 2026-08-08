import { hostname } from "node:os";
import { createPool } from "mysql2/promise";
import { loadAlipayConfig } from "./services/alipayProvider.js";
import { reconcileDuePaymentOrders } from "./services/paidHiringOperations.js";

if (process.env.PAID_HIRING_RECONCILIATION_ENABLED !== "true") process.exit(0);
const config = loadAlipayConfig();
if (!config)
  throw new Error(
    "PAID_HIRING_RECONCILIATION_ENABLED requires an enabled Alipay paid-hiring configuration",
  );
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.startsWith("mysql")) throw new Error("DATABASE_URL must be a MySQL URL");
const intervalMs = Math.min(
  Math.max(Number(process.env.PAID_HIRING_RECONCILIATION_POLL_INTERVAL_MS) || 60_000, 5_000),
  300_000,
);
const pool = createPool({
  uri: databaseUrl,
  connectionLimit: 1,
  waitForConnections: true,
  enableKeepAlive: true,
});
const workerId = `${hostname()}:${process.pid}`;
let stopping = false;
process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});
const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

console.info(
  JSON.stringify({ event: "paid_hiring.reconciliation.worker.started", workerId, concurrency: 1 }),
);
try {
  while (!stopping) {
    const processed = await reconcileDuePaymentOrders(pool, config, workerId);
    if (processed > 0)
      console.info(JSON.stringify({ event: "paid_hiring.reconciliation.processed", processed }));
    await sleep(processed > 0 ? 100 : intervalMs);
  }
} finally {
  await pool.end();
}
