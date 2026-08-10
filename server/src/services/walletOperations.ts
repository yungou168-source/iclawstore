import type { Pool, RowDataPacket } from 'mysql2/promise';
import { AiDirectHiringError, ErrorCodes } from './aiDirectErrors.js';
import { getWalletBalance } from './walletLedger.js';

export type WalletStatementItem = {
  id: string;
  entryType: string;
  businessType: string;
  businessId: string;
  availableDeltaFen: bigint;
  frozenDeltaFen: bigint;
  availableAfterFen: bigint;
  frozenAfterFen: bigint;
  reason: string | null;
  createdAt: Date;
};

const decodeCursor = (value?: string): { createdAt: string; id: string } | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      createdAt?: string;
      id?: string;
    };
    return typeof parsed.createdAt === 'string' && typeof parsed.id === 'string'
      ? { createdAt: parsed.createdAt, id: parsed.id }
      : null;
  } catch {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'cursor 无效');
  }
};

const encodeCursor = (row: { createdAt: Date; id: string }): string =>
  Buffer.from(JSON.stringify({ createdAt: row.createdAt.toISOString(), id: row.id })).toString(
    'base64url',
  );

export async function listWalletAccountsForAdmin(
  pool: Pick<Pool, 'query'>,
  input: { search?: string; limit?: number },
) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const search = input.search?.trim() ? `%${input.search.trim()}%` : null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT wa.userId, wa.currency, wa.availableFen, wa.frozenFen, wa.updatedAt,
            u.handle, u.displayName, u.email
     FROM wallet_accounts wa
     LEFT JOIN users u ON u.id = wa.userId
     WHERE (? IS NULL OR wa.userId LIKE ? OR u.handle LIKE ? OR u.email LIKE ?)
     ORDER BY wa.updatedAt DESC, wa.userId ASC LIMIT ?`,
    [search, search, search, search, limit],
  );
  return rows.map((row) => ({
    userId: row.userId,
    currency: 'CNY' as const,
    availableFen: BigInt(row.availableFen),
    frozenFen: BigInt(row.frozenFen),
    updatedAt: row.updatedAt,
    handle: row.handle ?? null,
    displayName: row.displayName ?? null,
    email: row.email ?? null,
  }));
}

export async function listRechargeOrdersForAdmin(
  pool: Pick<Pool, 'query'>,
  input: { status?: string; limit?: number },
) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, outTradeNo, userId, amountFen, status, providerTradeNo, paidAt, createdAt
     FROM wallet_recharge_orders WHERE (? IS NULL OR status = ?)
     ORDER BY createdAt DESC, id DESC LIMIT ?`,
    [input.status ?? null, input.status ?? null, limit],
  );
  return rows.map((row) => ({ ...row, amountFen: BigInt(row.amountFen) }));
}

export async function readWalletOverview(pool: Pool, userId: string) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const balance = await getWalletBalance(connection, userId);
    const [earnings] = await connection.query<RowDataPacket[]>(
      `SELECT
         COALESCE(SUM(CASE
           WHEN status = 'posted' AND direction = 'credit' THEN amountFen
           WHEN status = 'posted' AND direction = 'debit' THEN -amountFen
           ELSE 0 END), 0) AS availableFen,
         COALESCE(SUM(CASE
           WHEN status = 'settlement_pending' AND direction = 'credit' THEN amountFen
           WHEN status = 'settlement_pending' AND direction = 'debit' THEN -amountFen
           ELSE 0 END), 0) AS frozenFen
       FROM ai_direct_revenue_ledger_entries
       WHERE accountType = 'developer_payable' AND accountOwnerUserId = ? AND currency = 'CNY'`,
      [userId],
    );
    await connection.commit();
    return {
      currency: 'CNY' as const,
      availableFen: balance.availableFen,
      frozenFen: balance.frozenFen,
      withdrawableEarningsFen: BigInt(earnings[0]?.availableFen ?? 0),
      frozenEarningsFen: BigInt(earnings[0]?.frozenFen ?? 0),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function listWalletStatement(
  pool: Pick<Pool, 'query'>,
  userId: string,
  input: { limit?: number; cursor?: string; entryType?: string },
): Promise<{ items: WalletStatementItem[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
  const cursor = decodeCursor(input.cursor);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, entryType, businessType, businessId, availableDeltaFen, frozenDeltaFen,
            availableAfterFen, frozenAfterFen, reason, createdAt
     FROM wallet_ledger_entries
     WHERE userId = ? AND (? IS NULL OR entryType = ?)
       AND (? IS NULL OR createdAt < ? OR (createdAt = ? AND id < ?))
     ORDER BY createdAt DESC, id DESC LIMIT ?`,
    [
      userId,
      input.entryType ?? null,
      input.entryType ?? null,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      limit + 1,
    ],
  );
  const items = rows.slice(0, limit).map((row) => ({
    id: row.id,
    entryType: row.entryType,
    businessType: row.businessType,
    businessId: row.businessId,
    availableDeltaFen: BigInt(row.availableDeltaFen),
    frozenDeltaFen: BigInt(row.frozenDeltaFen),
    availableAfterFen: BigInt(row.availableAfterFen),
    frozenAfterFen: BigInt(row.frozenAfterFen),
    reason: row.reason,
    createdAt: row.createdAt,
  }));
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last) : null };
}