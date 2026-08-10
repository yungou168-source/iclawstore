import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { AlipayConfig, AlipayNotify } from './alipayProvider.js';
import { queryAlipayTrade } from './alipayProvider.js';
import { AiDirectHiringError, ErrorCodes } from './aiDirectErrors.js';
import { applyWalletLedgerChange } from './walletLedger.js';

export type RechargeOrder = {
  id: string;
  outTradeNo: string;
  status: string;
  currency: 'CNY';
  amountFen: bigint;
  providerTradeNo: string | null;
  paidAt: Date | null;
  createdAt: Date;
  replayed?: boolean;
};

type RechargeRow = RowDataPacket & {
  id: string;
  outTradeNo: string;
  userId: string;
  status: string;
  amountFen: bigint;
  idempotencyFingerprint: string;
  providerTradeNo: string | null;
  walletLedgerEntryId: string | null;
  paidAt: Date | null;
  createdAt: Date;
};

const newOutTradeNo = (): string =>
  `WAL${new Date().toISOString().replace(/\D/g, '').slice(0, 17)}${randomBytes(8).toString('hex').toUpperCase()}`;

const fingerprintAmount = (amountFen: bigint): string =>
  createHash('sha256').update(`CNY:${amountFen}`).digest('hex');

const toOrder = (row: RechargeRow, replayed?: boolean): RechargeOrder => ({
  id: row.id,
  outTradeNo: row.outTradeNo,
  status: row.status,
  currency: 'CNY',
  amountFen: BigInt(row.amountFen),
  providerTradeNo: row.providerTradeNo,
  paidAt: row.paidAt,
  createdAt: row.createdAt,
  replayed,
});

export function validateRechargeAmount(amountFen: bigint): void {
  if (amountFen < 100n || amountFen > 5_000_000n) {
    throw new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      '单笔充值金额必须为 1.00 至 50000.00 元',
    );
  }
}

export async function createRechargeOrder(
  pool: Pick<Pool, 'getConnection'>,
  input: { userId: string; amountFen: bigint; idempotencyKey: string },
): Promise<RechargeOrder> {
  validateRechargeAmount(input.amountFen);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const fingerprint = fingerprintAmount(input.amountFen);
    const [existingRows] = await connection.query<RechargeRow[]>(
      `SELECT id, outTradeNo, userId, status, amountFen, idempotencyFingerprint,
              providerTradeNo, walletLedgerEntryId, paidAt, createdAt
       FROM wallet_recharge_orders
       WHERE userId = ? AND idempotencyKey = ? LIMIT 1 FOR UPDATE`,
      [input.userId, input.idempotencyKey],
    );
    const existing = existingRows[0];
    if (existing) {
      if (existing.idempotencyFingerprint !== fingerprint) {
        throw new AiDirectHiringError(
          ErrorCodes.IDEMPOTENCY_KEY_REUSED,
          '充值幂等键已用于不同金额',
          409,
        );
      }
      await connection.commit();
      return toOrder(existing, true);
    }

    const id = randomUUID();
    const outTradeNo = newOutTradeNo();
    await connection.query(
      `INSERT INTO wallet_recharge_orders
       (id, outTradeNo, userId, provider, currency, amountFen, status,
        idempotencyKey, idempotencyFingerprint)
       VALUES (?, ?, ?, 'alipay', 'CNY', ?, 'pending', ?, ?)`,
      [id, outTradeNo, input.userId, input.amountFen, input.idempotencyKey, fingerprint],
    );
    const [rows] = await connection.query<RechargeRow[]>(
      `SELECT id, outTradeNo, userId, status, amountFen, idempotencyFingerprint,
              providerTradeNo, walletLedgerEntryId, paidAt, createdAt
       FROM wallet_recharge_orders WHERE id = ? LIMIT 1`,
      [id],
    );
    await connection.commit();
    return toOrder(rows[0]!);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function lockRechargeByOutTradeNo(
  connection: PoolConnection,
  outTradeNo: string,
): Promise<RechargeRow> {
  const [rows] = await connection.query<RechargeRow[]>(
    `SELECT id, outTradeNo, userId, status, amountFen, idempotencyFingerprint,
            providerTradeNo, walletLedgerEntryId, paidAt, createdAt
     FROM wallet_recharge_orders WHERE outTradeNo = ? LIMIT 1 FOR UPDATE`,
    [outTradeNo],
  );
  const row = rows[0];
  if (!row) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, '充值订单不存在', 404);
  return row;
}

export async function fulfillRecharge(
  pool: Pick<Pool, 'getConnection'>,
  notification: AlipayNotify,
): Promise<RechargeOrder> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const order = await lockRechargeByOutTradeNo(connection, notification.outTradeNo);
    if (BigInt(order.amountFen) !== notification.totalAmountFen) {
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '支付宝实付金额与充值订单不一致', 400);
    }
    if (order.status === 'paid') {
      if (order.providerTradeNo !== notification.tradeNo) {
        throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '支付宝交易号与充值订单不一致', 400);
      }
      await connection.commit();
      return toOrder(order, true);
    }
    if (order.status !== 'pending') {
      throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, '充值订单状态不允许入账', 409);
    }

    const ledger = await applyWalletLedgerChange(connection, {
      entryKey: `recharge:${order.id}`,
      userId: order.userId,
      entryType: 'recharge',
      businessType: 'recharge_order',
      businessId: order.id,
      availableDeltaFen: BigInt(order.amountFen),
      metadata: { provider: 'alipay', providerTradeNo: notification.tradeNo },
    });
    await connection.query(
      `UPDATE wallet_recharge_orders
       SET status = 'paid', providerTradeNo = ?, rawNotifySha256 = ?,
           walletLedgerEntryId = ?, paidAt = NOW(3), lastProviderStatus = 'TRADE_SUCCESS', updatedAt = NOW(3)
       WHERE id = ? AND status = 'pending'`,
      [notification.tradeNo, notification.rawNotifySha256, ledger.ledgerEntryId, order.id],
    );
    await connection.commit();
    return {
      ...toOrder(order),
      status: 'paid',
      providerTradeNo: notification.tradeNo,
      paidAt: new Date(),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function reconcileRechargeOrder(
  pool: Pick<Pool, 'getConnection' | 'query'>,
  config: AlipayConfig,
  orderId: string,
  userId: string,
): Promise<RechargeOrder> {
  const order = await getRechargeOrder(pool, orderId, userId);
  if (order.status !== 'pending') return order;
  const result = await queryAlipayTrade(config, order.outTradeNo);
  if (result.totalAmountFen !== null && result.totalAmountFen !== order.amountFen) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '支付宝查询金额与充值订单不一致', 400);
  }
  if (
    ['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(result.tradeStatus) &&
    result.tradeNo &&
    result.totalAmountFen !== null
  ) {
    return fulfillRecharge(pool, {
      outTradeNo: order.outTradeNo,
      tradeNo: result.tradeNo,
      totalAmountFen: result.totalAmountFen,
      rawNotifySha256: `query:${result.tradeNo}`,
    });
  }
  await pool.query(
    `UPDATE wallet_recharge_orders
     SET lastReconciledAt = NOW(3), lastProviderStatus = ?,
         status = IF(? AND status = 'pending', 'closed', status),
         closedAt = IF(? AND status = 'pending', NOW(3), closedAt)
     WHERE id = ? AND userId = ?`,
    [result.tradeStatus, result.tradeStatus === 'TRADE_CLOSED' ? 1 : 0, result.tradeStatus === 'TRADE_CLOSED' ? 1 : 0, orderId, userId],
  );
  return getRechargeOrder(pool, orderId, userId);
}

export async function getRechargeOrder(
  pool: Pick<Pool, 'query'>,
  orderId: string,
  userId: string,
): Promise<RechargeOrder> {
  const [rows] = await pool.query<RechargeRow[]>(
    `SELECT id, outTradeNo, userId, status, amountFen, idempotencyFingerprint,
            providerTradeNo, walletLedgerEntryId, paidAt, createdAt
     FROM wallet_recharge_orders WHERE id = ? AND userId = ? LIMIT 1`,
    [orderId, userId],
  );
  if (!rows[0]) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, '充值订单不存在', 404);
  return toOrder(rows[0]);
}