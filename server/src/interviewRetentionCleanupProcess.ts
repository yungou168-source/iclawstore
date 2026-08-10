import { createPool } from "mysql2/promise";
import { cleanExpiredInterviewData } from "./services/interviewRetentionCleanup.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.startsWith("mysql")) throw new Error("DATABASE_URL must be a MySQL URL");

const integer = (value: string | undefined, fallback: number, max: number): number => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
};
const intervalMs = integer(process.env.INTERVIEW_RETENTION_CLEANUP_INTERVAL_MS, 60_000, 3_600_000);
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

try {
  while (!stopping) {
    const result = await cleanExpiredInterviewData(pool, 20);
    if (result.deletedMessages || result.deletedAttachments)
      console.info(JSON.stringify({ event: "interview.retention.cleaned", ...result }));
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
} finally {
  await pool.end();
}
