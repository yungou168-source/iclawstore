import { randomUUID } from 'node:crypto';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { AiDirectHiringError, ErrorCodes } from './aiDirectErrors.js';

export type WalletBalance = {
  accountId: string;
  userId: string;
  currency: 'CNY';
  availableFen: bigint;
  frozenFen: bigint;
  version: bigint;
};

export type WalletEntryType =
  | 'recharge'
  | 'consume'
  | 'refund'
  | 'freeze'
  | 'unfreeze'
  | 'withdraw';

export type WalletLedgerChange = {
  entryKey: string;
  userId: string;
  entryType: WalletEntryType;
  businessType: string;
  businessId: string;
  availableDeltaFen: bigint;
  frozenDeltaFen?: bigint;
  actorUserId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type WalletLedgerResult = WalletBalance & {
  ledgerEntryId: string;
  replayed: boolean;
};

type AccountRow = RowDataPacket & {
  id: string;
  userId: string;
  availableFen: bigint;
  frozenFen: bigint;
  version: bigint;
};

type EntryRow = RowDataPacket & {
  id: string;
  userId: string;
  businessType: string;
  businessId: string;
  availableDeltaFen: bigint;
  frozenDeltaFen: bigint;
  availableAfterFen: bigint;
  frozenAfterFen: bigint;
};

const toBalance = (row: AccountRow): WalletBalance => ({
  accountId: row.id,
  userId: row.userId,
  currency: 'CNY',
  availableFen: BigInt(row.availableFen),
  frozenFen: BigInt(row.frozenFen),
  version: BigInt(row.version),
});

export async function lockWalletAccount(
  connection: PoolConnection,
  userId: string,
): Promise<WalletBalance> {
  await connection.query(
    `INSERT IGNORE INTO wallet_accounts
     (id, userId, currency, availableFen, frozenFen, version)
     VALUES (?, ?, 'CNY', 0, 0, 0)`,
    [randomUUID(), userId],
  );
  const [rows] = await connection.query<AccountRow[]>(
    `SELECT id, userId, availableFen, frozenFen, version
     FROM wallet_accounts WHERE userId = ? AND currency = 'CNY' LIMIT 1 FOR UPDATE`,
    [userId],
  );
  const row = rows[0];
  if (!row) throw new AiDirectHiringError(ErrorCodes.INTERNAL_ERROR, '钱包账户创建失败', 500);
  return toBalance(row);
}

export async function getWalletBalance(
  connection: PoolConnection,
  userId: string,
): Promise<WalletBalance> {
  return lockWalletAccount(connection, userId);
}

export async function applyWalletLedgerChange(
  connection: PoolConnection,
  change: WalletLedgerChange,
): Promise<WalletLedgerResult> {
  const account = await lockWalletAccount(connection, change.userId);
  const frozenDeltaFen = change.frozenDeltaFen ?? 0n;
  const [existingRows] = await connection.query<EntryRow[]>(
    `SELECT id, userId, businessType, businessId, availableDeltaFen, frozenDeltaFen,
            availableAfterFen, frozenAfterFen
     FROM wallet_ledger_entries WHERE entryKey = ? LIMIT 1`,
    [change.entryKey],
  );
  const existing = existingRows[0];
  if (existing) {
    if (
      existing.userId !== change.userId ||
      existing.businessType !== change.businessType ||
      existing.businessId !== change.businessId ||
      BigInt(existing.availableDeltaFen) !== change.availableDeltaFen ||
      BigInt(existing.frozenDeltaFen) !== frozenDeltaFen
    ) {
      throw new AiDirectHiringError(
        ErrorCodes.IDEMPOTENCY_KEY_REUSED,
        '钱包流水幂等键已用于不同业务',
        409,
      );
    }
    return {
      ...account,
      availableFen: BigInt(existing.availableAfterFen),
      frozenFen: BigInt(existing.frozenAfterFen),
      ledgerEntryId: existing.id,
      replayed: true,
    };
  }

  const availableAfterFen = account.availableFen + change.availableDeltaFen;
  const frozenAfterFen = account.frozenFen + frozenDeltaFen;
  if (availableAfterFen < 0n) {
    throw new AiDirectHiringError(
      ErrorCodes.BUDGET_EXCEEDED,
      '钱包可用余额不足',
      409,
      { availableFen: String(account.availableFen), requiredFen: String(-change.availableDeltaFen) },
    );
  }
  if (frozenAfterFen < 0n) {
    throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, '钱包冻结余额不足', 409);
  }
  const [updated] = await connection.query<ResultSetHeader>(
    `UPDATE wallet_accounts
     SET availableFen = ?, frozenFen = ?, version = version + 1, updatedAt = NOW(3)
     WHERE id = ? AND version = ?`,
    [availableAfterFen, frozenAfterFen, account.accountId, account.version],
  );
  if (updated.affectedRows !== 1) {
    throw new AiDirectHiringError(ErrorCodes.REVISION_CONFLICT, '钱包余额发生并发变化', 409);
  }

  const ledgerEntryId = randomUUID();
  await connection.query(
    `INSERT INTO wallet_ledger_entries
     (id, entryKey, walletAccountId, userId, currency, entryType, businessType, businessId,
      availableDeltaFen, frozenDeltaFen, availableAfterFen, frozenAfterFen,
      actorUserId, reason, metadata)
     VALUES (?, ?, ?, ?, 'CNY', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ledgerEntryId,
      change.entryKey,
      account.accountId,
      change.userId,
      change.entryType,
      change.businessType,
      change.businessId,
      change.availableDeltaFen,
      frozenDeltaFen,
      availableAfterFen,
      frozenAfterFen,
      change.actorUserId ?? null,
      change.reason ?? null,
      change.metadata ? JSON.stringify(change.metadata) : null,
    ],
  );
  return {
    ...account,
    availableFen: availableAfterFen,
    frozenFen: frozenAfterFen,
    version: account.version + 1n,
    ledgerEntryId,
    replayed: false,
  };
}