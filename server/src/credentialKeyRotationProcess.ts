import { createPool } from "mysql2/promise";
import { loadCredentialKeyring } from "./services/credentialKeyring.js";
import { rotateCredentialKeys } from "./services/credentialKeyRotation.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.startsWith("mysql")) throw new Error("DATABASE_URL must be a MySQL URL");

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("CREDENTIAL_ROTATION_DRY_RUN must be true or false");
}

function readInteger(value: string | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) {
    throw new Error(`Credential rotation integer must be between 0 and ${max}`);
  }
  return parsed;
}

const keyringPath =
  process.env.CREDENTIAL_KEYRING_PATH ?? "/home/ubuntu/.config/iclawstore/credential-keyring.json";
const dryRun = readBoolean(process.env.CREDENTIAL_ROTATION_DRY_RUN, true);
const limit = readInteger(process.env.CREDENTIAL_ROTATION_LIMIT, 100, 10_000);
const sleepMs = readInteger(process.env.CREDENTIAL_ROTATION_SLEEP_MS, 50, 60_000);
const keyring = loadCredentialKeyring(keyringPath);
const pool = createPool({
  uri: databaseUrl,
  connectionLimit: 1,
  waitForConnections: true,
  enableKeepAlive: true,
});

try {
  const result = await rotateCredentialKeys(pool, keyring, { dryRun, limit, sleepMs });
  console.info(JSON.stringify({ event: "credential.rotation.completed", ...result }));
} catch {
  console.error(JSON.stringify({ event: "credential.rotation.failed" }));
  process.exitCode = 1;
} finally {
  await pool.end();
  keyring.fingerprintKey.fill(0);
  for (const key of keyring.encryptionKeys.values()) key.fill(0);
}
