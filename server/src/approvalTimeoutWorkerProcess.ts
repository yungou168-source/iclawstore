import { hostname } from "node:os";
import { createPool } from "mysql2/promise";
import { expireDueApprovals } from "./services/approvalTimeoutWorker.js";

if (process.env.APPROVAL_TIMEOUT_ENABLED !== "true") process.exit(0);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.startsWith("mysql")) throw new Error("DATABASE_URL must be a MySQL URL");
const intervalMs = Math.min(
  Math.max(Number(process.env.APPROVAL_TIMEOUT_POLL_INTERVAL_MS) || 30_000, 5_000),
  300_000,
);
const pool = createPool({
  uri: databaseUrl,
  connectionLimit: 1,
  waitForConnections: true,
  enableKeepAlive: true,
});
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
  JSON.stringify({
    event: "approval.timeout.worker.started",
    workerId: `${hostname()}:${process.pid}`,
    concurrency: 1,
  }),
);
try {
  while (!stopping) {
    const expired = await expireDueApprovals(pool);
    if (expired) console.info(JSON.stringify({ event: "approval.timeout.expired", expired }));
    await sleep(expired ? 100 : intervalMs);
  }
} finally {
  await pool.end();
}
