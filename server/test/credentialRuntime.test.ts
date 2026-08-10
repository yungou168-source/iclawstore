import { afterEach, describe, expect, it, vi } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool, ResultSetHeader } from "mysql2/promise";
import {
  loadCredentialKeyring,
  type CredentialKeyring,
} from "../src/services/credentialKeyring.js";
import { rotateCredentialKeys } from "../src/services/credentialKeyRotation.js";
import {
  decryptCredential,
  encryptCredential,
  fingerprintCredential,
} from "../src/services/credentialVault.js";
import {
  createMysqlCredentialStore,
  CredentialWriteConflictError,
} from "../src/services/mysqlCredentialStore.js";

const temporaryDirectories: string[] = [];

function testKeyring(activeVersion = "k20260805-01"): CredentialKeyring {
  return {
    activeVersion,
    encryptionKeys: new Map([
      ["k20260804-01", Uint8Array.from({ length: 32 }, (_, index) => index + 1)],
      ["k20260805-01", Uint8Array.from({ length: 32 }, (_, index) => index + 33)],
    ]),
    fingerprintKey: Uint8Array.from({ length: 32 }, (_, index) => 255 - index),
  };
}

function cipherContext() {
  return {
    credentialId: "credential-1",
    ownerUserId: "user-1",
    providerKey: "jinsha",
    credentialVersion: 2,
  } as const;
}

function encodedCredentialRow(keyring: CredentialKeyring) {
  const envelope = encryptCredential(
    keyring,
    cipherContext(),
    Uint8Array.from([115, 101, 99, 114, 101, 116]),
  );
  return {
    id: "credential-1",
    userId: "user-1",
    provider: "jinsha",
    label: "金沙",
    fingerprint: "a".repeat(64),
    cipherText: Buffer.from(envelope.ciphertext).toString("base64"),
    iv: Buffer.from(envelope.nonce).toString("base64"),
    authTag: Buffer.from(envelope.authenticationTag).toString("base64"),
    keyVersion: envelope.keyVersion,
    credentialVersion: 2,
    validationStatus: "valid" as const,
    validatedAt: new Date(),
    lastUsedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    revokedAt: null,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("credential keyring", () => {
  it("loads canonical 32-byte keys from a restricted regular file", () => {
    const directory = mkdtempSync(join(tmpdir(), "credential-keyring-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "keyring.json");
    writeFileSync(
      path,
      JSON.stringify({
        activeVersion: "k20260805-01",
        keys: { "k20260805-01": Buffer.alloc(32, 1).toString("base64") },
        fingerprintKey: Buffer.alloc(32, 2).toString("base64"),
      }),
      { mode: 0o600 },
    );

    const keyring = loadCredentialKeyring(path);
    expect(keyring.activeVersion).toBe("k20260805-01");
    expect(keyring.encryptionKeys.get("k20260805-01")).toHaveLength(32);
    expect(keyring.fingerprintKey).toHaveLength(32);
  });

  it("rejects symlinks and reuse of an encryption key as fingerprint key", () => {
    const directory = mkdtempSync(join(tmpdir(), "credential-keyring-"));
    temporaryDirectories.push(directory);
    const target = join(directory, "target.json");
    const link = join(directory, "keyring.json");
    const key = Buffer.alloc(32, 3).toString("base64");
    writeFileSync(
      target,
      JSON.stringify({
        activeVersion: "k1",
        keys: { k1: key },
        fingerprintKey: key,
      }),
      { mode: 0o600 },
    );
    symlinkSync(target, link);

    expect(() => loadCredentialKeyring(link)).toThrow();
    expect(() => loadCredentialKeyring(target)).toThrow("must be independent");
  });
});

describe("credential vault", () => {
  it("round-trips a secret and binds every identity field through AAD", () => {
    const keyring = testKeyring();
    const secret = Uint8Array.from([1, 2, 3, 4, 5]);
    const encrypted = encryptCredential(keyring, cipherContext(), secret);

    expect(decryptCredential(keyring, cipherContext(), encrypted)).toEqual(secret);
    expect(() =>
      decryptCredential(keyring, { ...cipherContext(), ownerUserId: "user-2" }, encrypted),
    ).toThrow();
    expect(() =>
      decryptCredential(keyring, { ...cipherContext(), credentialVersion: 3 }, encrypted),
    ).toThrow();
    expect(fingerprintCredential(keyring, secret)).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("MySQL credential store", () => {
  it("allows one lease consumption and clears callback plaintext afterward", async () => {
    const keyring = testKeyring();
    const row = encodedCredentialRow(keyring);
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT")) return [[row], []];
        return [{ affectedRows: 1 } satisfies Partial<ResultSetHeader>, []];
      }),
    } as unknown as Pool;
    const store = createMysqlCredentialStore(pool, keyring);
    const lease = await store.lease(row.id, row.userId);
    let exposed: Uint8Array | undefined;

    const result = await lease!.withSecret(async (secret) => {
      exposed = secret;
      return Array.from(secret);
    });

    expect(result).toEqual([115, 101, 99, 114, 101, 116]);
    expect(exposed).toBeDefined();
    expect(Array.from(exposed!)).toEqual([0, 0, 0, 0, 0, 0]);
    await expect(lease!.withSecret(async () => null)).rejects.toThrow("already been consumed");
  });

  it("does not mask a consumer failure with last-used persistence", async () => {
    const keyring = testKeyring();
    const row = encodedCredentialRow(keyring);
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT")) return [[row], []];
        return [{ affectedRows: 1 } satisfies Partial<ResultSetHeader>, []];
      }),
    } as unknown as Pool;
    const store = createMysqlCredentialStore(pool, keyring);
    const lease = await store.lease(row.id, row.userId);

    await expect(
      lease!.withSecret(async () => {
        throw new Error("consumer failed");
      }),
    ).rejects.toThrow("consumer failed");
  });

  it("maps provider uniqueness races to a stable write conflict", async () => {
    const duplicate = Object.assign(new Error("database detail"), { code: "ER_DUP_ENTRY" });
    const pool = {
      query: vi.fn(async () => {
        throw duplicate;
      }),
    } as unknown as Pool;
    const keyring = testKeyring();
    const store = createMysqlCredentialStore(pool, keyring);

    await expect(
      store.saveEncrypted({
        id: "credential-2",
        ownerUserId: "user-1",
        providerKey: "jinsha",
        label: "金沙",
        fingerprint: "a".repeat(64),
        version: 1,
        envelope: encryptCredential(
          keyring,
          {
            credentialId: "credential-2",
            ownerUserId: "user-1",
            providerKey: "jinsha",
            credentialVersion: 1,
          },
          Uint8Array.from([1]),
        ),
      }),
    ).rejects.toBeInstanceOf(CredentialWriteConflictError);
  });

  it("looks up metadata by both owner and provider without decrypting", async () => {
    const row = encodedCredentialRow(testKeyring());
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values });
        return [[row], []];
      }),
    } as unknown as Pool;
    const store = createMysqlCredentialStore(pool, testKeyring());

    const result = await store.metadataForProvider("user-1", "jinsha");

    expect(result).toMatchObject({ id: row.id, ownerUserId: "user-1", providerKey: "jinsha" });
    expect(calls[0]!.sql).toContain("WHERE userId = ? AND provider = ?");
    expect(calls[0]!.values).toEqual(["user-1", "jinsha"]);
  });

  it("rewraps only the expected content and key versions without changing content updatedAt", async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values });
        return [{ affectedRows: 1 } satisfies Partial<ResultSetHeader>, []];
      }),
    } as unknown as Pool;
    const keyring = testKeyring();
    const store = createMysqlCredentialStore(pool, keyring);
    const envelope = encryptCredential(keyring, cipherContext(), Uint8Array.from([1]));

    await expect(store.rewrap("credential-1", "user-1", 2, "k20260804-01", envelope)).resolves.toBe(
      true,
    );
    expect(calls[0]!.sql).toContain("updatedAt = updatedAt");
    expect(calls[0]!.sql).toContain("credentialVersion = ? AND keyVersion = ?");
    expect(calls[0]!.values?.slice(-4)).toEqual(["credential-1", "user-1", 2, "k20260804-01"]);
  });
});

describe("credential key rotation", () => {
  it("defaults to dry-run and reports versions without locking or decrypting rows", async () => {
    const pool = {
      query: vi.fn(async () => [[{ keyVersion: "k20260804-01", count: 2 }], []]),
      getConnection: vi.fn(),
    } as unknown as Pool;

    const result = await rotateCredentialKeys(pool, testKeyring());

    expect(result).toMatchObject({ dryRun: true, rotated: 0, remaining: 2 });
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  it("rewraps one locked row with unchanged content version and an audit in one transaction", async () => {
    const keyring = testKeyring();
    const candidate = encodedCredentialRow(testKeyring("k20260804-01"));
    const connectionCalls: Array<{ sql: string; values?: unknown[] }> = [];
    const connection = {
      beginTransaction: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
      release: vi.fn(),
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        connectionCalls.push({ sql, values });
        if (sql.includes("SELECT")) return [[candidate], []];
        return [{ affectedRows: 1 } satisfies Partial<ResultSetHeader>, []];
      }),
    };
    let countQuery = 0;
    const pool = {
      query: vi.fn(async () => {
        countQuery += 1;
        return countQuery === 1
          ? [[{ keyVersion: "k20260804-01", count: 1 }], []]
          : [[{ keyVersion: "k20260805-01", count: 1 }], []];
      }),
      getConnection: vi.fn(async () => connection),
    } as unknown as Pool;

    const result = await rotateCredentialKeys(pool, keyring, {
      dryRun: false,
      limit: 1,
      sleepMs: 0,
      rotationId: "rotation-test-1",
    });

    expect(result).toMatchObject({ dryRun: false, rotated: 1, remaining: 0 });
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
    const update = connectionCalls.find(({ sql }) =>
      sql.includes("UPDATE ai_direct_user_credentials"),
    )!;
    expect(update.sql).toContain("updatedAt = updatedAt");
    expect(update.values?.slice(-4)).toEqual([
      candidate.id,
      candidate.userId,
      candidate.credentialVersion,
      candidate.keyVersion,
    ]);
    const audit = connectionCalls.find(({ sql }) =>
      sql.includes("INSERT INTO ai_direct_audit_events"),
    )!;
    expect(audit.values?.[1]).toBe(candidate.id);
    expect(audit.values?.[2]).toBe("rotation-test-1");
    expect(String(audit.values?.[3])).not.toContain(candidate.cipherText);
  });
});
