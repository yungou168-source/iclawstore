import type { Pool, ResultSetHeader } from "mysql2/promise";
import type {
  CredentialMetadata,
  CredentialStore,
  EncryptedCredentialEnvelope,
  SaveEncryptedCredentialInput,
} from "../contracts/credentialStore.js";
import type { CredentialLease } from "../contracts/modelProvider.js";
import type { CredentialKeyring } from "./credentialKeyring.js";
import { decryptCredential } from "./credentialVault.js";

export class CredentialWriteConflictError extends Error {
  constructor() {
    super("Credential was concurrently modified");
    this.name = "CredentialWriteConflictError";
  }
}

type CredentialRow = {
  id: string;
  userId: string;
  provider: string;
  label: string;
  fingerprint: string | null;
  cipherText: string;
  iv: string;
  authTag: string;
  keyVersion: string;
  credentialVersion: number;
  validationStatus: "unvalidated" | "valid" | "invalid";
  validatedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
};

const SELECT_COLUMNS = `id, userId, provider, label, fingerprint, cipherText, iv, authTag,
  keyVersion, credentialVersion, validationStatus, validatedAt, lastUsedAt,
  createdAt, updatedAt, revokedAt`;

function metadata(row: CredentialRow): CredentialMetadata {
  return {
    id: row.id,
    ownerUserId: row.userId,
    providerKey: row.provider,
    label: row.label,
    fingerprint: row.fingerprint ?? "",
    version: Number(row.credentialVersion),
    keyVersion: row.keyVersion,
    status: row.revokedAt ? "revoked" : "active",
    validationStatus: row.validationStatus,
    validatedAt: row.validatedAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revokedAt: row.revokedAt,
  };
}

function encode(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}

function envelope(row: CredentialRow): EncryptedCredentialEnvelope {
  return {
    algorithm: "aes-256-gcm",
    keyVersion: row.keyVersion,
    ciphertext: new Uint8Array(Buffer.from(row.cipherText, "base64")),
    nonce: new Uint8Array(Buffer.from(row.iv, "base64")),
    authenticationTag: new Uint8Array(Buffer.from(row.authTag, "base64")),
  };
}

export function createMysqlCredentialStore(
  pool: Pool,
  keyring: CredentialKeyring,
): CredentialStore {
  const read = async (credentialId: string, ownerUserId: string): Promise<CredentialRow | null> => {
    const [rows] = await pool.query(
      `SELECT ${SELECT_COLUMNS} FROM ai_direct_user_credentials
       WHERE id = ? AND userId = ? LIMIT 1`,
      [credentialId, ownerUserId],
    );
    return (rows as CredentialRow[])[0] ?? null;
  };

  const readForProvider = async (
    ownerUserId: string,
    providerKey: string,
  ): Promise<CredentialRow | null> => {
    const [rows] = await pool.query(
      `SELECT ${SELECT_COLUMNS} FROM ai_direct_user_credentials
       WHERE userId = ? AND provider = ? LIMIT 1`,
      [ownerUserId, providerKey],
    );
    return (rows as CredentialRow[])[0] ?? null;
  };

  const readMetadata = async (
    credentialId: string,
    ownerUserId: string,
  ): Promise<CredentialMetadata | null> => {
    const row = await read(credentialId, ownerUserId);
    return row ? metadata(row) : null;
  };

  const saveEncrypted = async (
    input: SaveEncryptedCredentialInput,
  ): Promise<CredentialMetadata> => {
    try {
      await pool.query(
        `INSERT INTO ai_direct_user_credentials
         (id, userId, provider, label, fingerprint, cipherText, iv, authTag,
          keyVersion, credentialVersion, validationStatus, validatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'valid', NOW(3))`,
        [
          input.id,
          input.ownerUserId,
          input.providerKey,
          input.label,
          input.fingerprint,
          encode(input.envelope.ciphertext),
          encode(input.envelope.nonce),
          encode(input.envelope.authenticationTag),
          input.envelope.keyVersion,
          input.version,
        ],
      );
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ER_DUP_ENTRY") {
        throw new CredentialWriteConflictError();
      }
      throw error;
    }
    const result = await readMetadata(input.id, input.ownerUserId);
    if (!result) throw new Error("Credential was not persisted");
    return result;
  };

  const rotate = async (
    credentialId: string,
    ownerUserId: string,
    version: number,
    nextEnvelope: EncryptedCredentialEnvelope,
    fingerprint: string,
  ): Promise<CredentialMetadata> => {
    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE ai_direct_user_credentials
       SET fingerprint = ?, cipherText = ?, iv = ?, authTag = ?, keyVersion = ?,
           credentialVersion = ?, validationStatus = 'valid', validatedAt = NOW(3),
           revokedAt = NULL, updatedAt = NOW(3)
       WHERE id = ? AND userId = ? AND credentialVersion = ?`,
      [
        fingerprint,
        encode(nextEnvelope.ciphertext),
        encode(nextEnvelope.nonce),
        encode(nextEnvelope.authenticationTag),
        nextEnvelope.keyVersion,
        version,
        credentialId,
        ownerUserId,
        version - 1,
      ],
    );
    if (result.affectedRows !== 1) throw new CredentialWriteConflictError();
    const updated = await readMetadata(credentialId, ownerUserId);
    if (!updated) throw new Error("Credential was not found after rotation");
    return updated;
  };

  const rewrap = async (
    credentialId: string,
    ownerUserId: string,
    expectedCredentialVersion: number,
    expectedKeyVersion: string,
    nextEnvelope: EncryptedCredentialEnvelope,
  ): Promise<boolean> => {
    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE ai_direct_user_credentials
       SET cipherText = ?, iv = ?, authTag = ?, keyVersion = ?, updatedAt = updatedAt
       WHERE id = ? AND userId = ? AND credentialVersion = ? AND keyVersion = ?
         AND revokedAt IS NULL`,
      [
        encode(nextEnvelope.ciphertext),
        encode(nextEnvelope.nonce),
        encode(nextEnvelope.authenticationTag),
        nextEnvelope.keyVersion,
        credentialId,
        ownerUserId,
        expectedCredentialVersion,
        expectedKeyVersion,
      ],
    );
    return result.affectedRows === 1;
  };

  const markValidation = async (
    credentialId: string,
    ownerUserId: string,
    status: "valid" | "invalid",
  ): Promise<boolean> => {
    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE ai_direct_user_credentials
       SET validationStatus = ?, validatedAt = NOW(3), updatedAt = NOW(3)
       WHERE id = ? AND userId = ? AND revokedAt IS NULL`,
      [status, credentialId, ownerUserId],
    );
    return result.affectedRows === 1;
  };

  const lease = async (
    credentialId: string,
    ownerUserId: string,
  ): Promise<CredentialLease | null> => {
    const row = await read(credentialId, ownerUserId);
    if (!row || row.revokedAt || row.validationStatus !== "valid") return null;
    let consumed = false;
    return {
      credentialId: row.id,
      providerKey: row.provider,
      version: Number(row.credentialVersion),
      withSecret: async <T>(consumer: (secret: Uint8Array) => Promise<T>): Promise<T> => {
        if (consumed) throw new Error("Credential lease has already been consumed");
        consumed = true;
        const secret = decryptCredential(
          keyring,
          {
            credentialId: row.id,
            ownerUserId: row.userId,
            providerKey: row.provider,
            credentialVersion: Number(row.credentialVersion),
          },
          envelope(row),
        );
        try {
          const [usage] = await pool.query<ResultSetHeader>(
            `UPDATE ai_direct_user_credentials SET lastUsedAt = NOW(3)
             WHERE id = ? AND userId = ? AND credentialVersion = ? AND keyVersion = ?
               AND validationStatus = 'valid' AND revokedAt IS NULL`,
            [row.id, row.userId, row.credentialVersion, row.keyVersion],
          );
          if (usage.affectedRows !== 1) throw new Error("Credential lease is no longer valid");
          return await consumer(secret);
        } finally {
          secret.fill(0);
        }
      },
    };
  };

  const revoke = async (credentialId: string, ownerUserId: string): Promise<boolean> => {
    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE ai_direct_user_credentials
       SET revokedAt = NOW(3), validationStatus = 'invalid', updatedAt = NOW(3)
       WHERE id = ? AND userId = ? AND revokedAt IS NULL`,
      [credentialId, ownerUserId],
    );
    return result.affectedRows === 1;
  };

  return Object.freeze({
    saveEncrypted,
    metadata: readMetadata,
    metadataForProvider: async (ownerUserId, providerKey) => {
      const row = await readForProvider(ownerUserId, providerKey);
      return row ? metadata(row) : null;
    },
    lease,
    rotate,
    rewrap,
    markValidation,
    revoke,
  });
}
