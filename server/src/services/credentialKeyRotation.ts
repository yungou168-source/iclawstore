import { randomUUID } from "node:crypto";
import type { Pool, PoolConnection, ResultSetHeader } from "mysql2/promise";
import type { EncryptedCredentialEnvelope } from "../contracts/credentialStore.js";
import type { CredentialKeyring } from "./credentialKeyring.js";
import { decryptCredential, encryptCredential } from "./credentialVault.js";

type RotationCandidate = {
  id: string;
  userId: string;
  provider: string;
  cipherText: string;
  iv: string;
  authTag: string;
  keyVersion: string;
  credentialVersion: number;
};

export type CredentialKeyVersionCount = Readonly<{
  keyVersion: string;
  count: number;
}>;

export type CredentialRotationOptions = Readonly<{
  dryRun?: boolean;
  limit?: number;
  sleepMs?: number;
  rotationId?: string;
}>;

export type CredentialRotationResult = Readonly<{
  dryRun: boolean;
  activeVersion: string;
  rotated: number;
  remaining: number;
  versionsBefore: readonly CredentialKeyVersionCount[];
  versionsAfter: readonly CredentialKeyVersionCount[];
}>;

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function readBoundedInteger(value: number | undefined, fallback: number, max: number): number {
  return Number.isSafeInteger(value) && value! >= 0 ? Math.min(value!, max) : fallback;
}

function decodeEnvelope(row: RotationCandidate): EncryptedCredentialEnvelope {
  return {
    algorithm: "aes-256-gcm",
    keyVersion: row.keyVersion,
    ciphertext: Uint8Array.from(Buffer.from(row.cipherText, "base64")),
    nonce: Uint8Array.from(Buffer.from(row.iv, "base64")),
    authenticationTag: Uint8Array.from(Buffer.from(row.authTag, "base64")),
  };
}

function encode(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}

async function keyVersionCounts(pool: Pool): Promise<CredentialKeyVersionCount[]> {
  const [rows] = await pool.query(
    `SELECT keyVersion, COUNT(*) AS count
     FROM ai_direct_user_credentials
     WHERE revokedAt IS NULL
     GROUP BY keyVersion
     ORDER BY keyVersion ASC`,
  );
  return (rows as Array<{ keyVersion: string; count: number | string }>).map((row) => ({
    keyVersion: row.keyVersion,
    count: Number(row.count),
  }));
}

async function lockNextCandidate(
  connection: PoolConnection,
  activeVersion: string,
): Promise<RotationCandidate | null> {
  const [rows] = await connection.query(
    `SELECT id, userId, provider, cipherText, iv, authTag, keyVersion, credentialVersion
     FROM ai_direct_user_credentials
     WHERE revokedAt IS NULL AND keyVersion <> ?
     ORDER BY keyVersion ASC, id ASC
     LIMIT 1
     FOR UPDATE SKIP LOCKED`,
    [activeVersion],
  );
  return (rows as RotationCandidate[])[0] ?? null;
}

async function rewrapLockedCandidate(
  connection: PoolConnection,
  keyring: CredentialKeyring,
  candidate: RotationCandidate,
  rotationId: string,
): Promise<void> {
  const context = {
    credentialId: candidate.id,
    ownerUserId: candidate.userId,
    providerKey: candidate.provider,
    credentialVersion: Number(candidate.credentialVersion),
  };
  const plaintext = decryptCredential(keyring, context, decodeEnvelope(candidate));
  try {
    const envelope = encryptCredential(keyring, context, plaintext);
    const [updated] = await connection.query<ResultSetHeader>(
      `UPDATE ai_direct_user_credentials
       SET cipherText = ?, iv = ?, authTag = ?, keyVersion = ?, updatedAt = updatedAt
       WHERE id = ? AND userId = ? AND credentialVersion = ? AND keyVersion = ?
         AND revokedAt IS NULL`,
      [
        encode(envelope.ciphertext),
        encode(envelope.nonce),
        encode(envelope.authenticationTag),
        envelope.keyVersion,
        candidate.id,
        candidate.userId,
        candidate.credentialVersion,
        candidate.keyVersion,
      ],
    );
    if (updated.affectedRows !== 1) throw new Error("Credential key rotation conflict");

    await connection.query(
      `INSERT INTO ai_direct_audit_events
       (id, organizationId, actorUserId, action, targetType, targetId, requestId, outcome, metadata)
       VALUES (?, NULL, 'system:credential-key-rotation', 'credential.key_rewrapped',
               'credential', ?, ?, 'success', ?)`,
      [
        randomUUID(),
        candidate.id,
        rotationId,
        JSON.stringify({
          fromKeyVersion: candidate.keyVersion,
          toKeyVersion: envelope.keyVersion,
          credentialVersion: Number(candidate.credentialVersion),
        }),
      ],
    );
  } finally {
    plaintext.fill(0);
  }
}

export async function rotateCredentialKeys(
  pool: Pool,
  keyring: CredentialKeyring,
  options: CredentialRotationOptions = {},
): Promise<CredentialRotationResult> {
  const dryRun = options.dryRun ?? true;
  const limit = readBoundedInteger(options.limit, 100, 10_000);
  const sleepMs = readBoundedInteger(options.sleepMs, 50, 60_000);
  const rotationId = options.rotationId ?? randomUUID();
  const versionsBefore = await keyVersionCounts(pool);
  const remainingBefore = versionsBefore
    .filter(({ keyVersion }) => keyVersion !== keyring.activeVersion)
    .reduce((sum, { count }) => sum + count, 0);

  if (dryRun || limit === 0 || remainingBefore === 0) {
    return {
      dryRun,
      activeVersion: keyring.activeVersion,
      rotated: 0,
      remaining: remainingBefore,
      versionsBefore,
      versionsAfter: versionsBefore,
    };
  }

  let rotated = 0;
  while (rotated < limit) {
    const connection = await pool.getConnection();
    let found = false;
    try {
      await connection.beginTransaction();
      const candidate = await lockNextCandidate(connection, keyring.activeVersion);
      if (!candidate) {
        await connection.rollback();
        break;
      }
      found = true;
      await rewrapLockedCandidate(connection, keyring, candidate, rotationId);
      await connection.commit();
      rotated += 1;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    if (found && rotated < limit && sleepMs > 0) await sleep(sleepMs);
  }

  const versionsAfter = await keyVersionCounts(pool);
  const remaining = versionsAfter
    .filter(({ keyVersion }) => keyVersion !== keyring.activeVersion)
    .reduce((sum, { count }) => sum + count, 0);
  return {
    dryRun,
    activeVersion: keyring.activeVersion,
    rotated,
    remaining,
    versionsBefore,
    versionsAfter,
  };
}
