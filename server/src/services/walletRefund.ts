import { randomUUID } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { publishOutboxEvent } from "../utils/outbox.js";
import { AiDirectHiringError, ErrorCodes } from "./aiDirectErrors.js";
import { splitPaidHiringAmount } from "./paidHiringMoney.js";
import { applyWalletLedgerChange } from "./walletLedger.js";

type RefundRow = RowDataPacket & {
  id: string;
  paymentOrderId: string;
  userId: string;
  amountFen: bigint;
  status: string;
  reason: string;
};

export async function createWalletRefund(
  pool: Pick<Pool, "getConnection">,
  input: {
    paymentOrderId: string;
    amountFen: bigint;
    reason: string;
    requestedByUserId: string;
  },
) {
  if (input.amountFen <= 0n || !input.reason.trim()) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "退款金额和原因不能为空");
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [orders] = await connection.query<RowDataPacket[]>(
      `SELECT id, payerUserId, grossAmountFen, refundedFen, status
       FROM ai_direct_payment_orders WHERE id = ? LIMIT 1 FOR UPDATE`,
      [input.paymentOrderId],
    );
    const order = orders[0];
    if (!order || !order.payerUserId) {
      throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "钱包支付订单不存在", 404);
    }
    if (order.status !== "fulfilled") {
      throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, "仅已履约订单可以退款", 409);
    }
    const refundableFen = BigInt(order.grossAmountFen) - BigInt(order.refundedFen);
    if (input.amountFen > refundableFen) {
      throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, "退款金额超过订单可退金额", 409);
    }
    const id = randomUUID();
    await connection.query(
      `INSERT INTO wallet_refund_orders
       (id, paymentOrderId, userId, currency, amountFen, status, reason, requestedByUserId)
       VALUES (?, ?, ?, 'CNY', ?, 'pending', ?, ?)`,
      [
        id,
        input.paymentOrderId,
        order.payerUserId,
        input.amountFen,
        input.reason.trim(),
        input.requestedByUserId,
      ],
    );
    await connection.commit();
    return {
      id,
      paymentOrderId: input.paymentOrderId,
      userId: order.payerUserId,
      amountFen: input.amountFen,
      status: "pending" as const,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function reviewWalletRefund(
  pool: Pick<Pool, "getConnection">,
  input: { refundId: string; approved: boolean; reviewerUserId: string; reviewNote?: string },
) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [refunds] = await connection.query<RefundRow[]>(
      `SELECT id, paymentOrderId, userId, amountFen, status, reason
       FROM wallet_refund_orders WHERE id = ? LIMIT 1 FOR UPDATE`,
      [input.refundId],
    );
    const refund = refunds[0];
    if (!refund) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "退款申请不存在", 404);
    if (refund.status !== "pending") {
      throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, "退款申请已处理", 409);
    }
    if (!input.approved) {
      await connection.query(
        `UPDATE wallet_refund_orders SET status = 'rejected', reviewedByUserId = ?, reviewNote = ?, updatedAt = NOW(3)
         WHERE id = ? AND status = 'pending'`,
        [input.reviewerUserId, input.reviewNote ?? null, refund.id],
      );
      await connection.commit();
      return { id: refund.id, status: "rejected" as const };
    }

    const [orders] = await connection.query<RowDataPacket[]>(
      `SELECT orderRow.id, orderRow.grossAmountFen, orderRow.refundedFen,
              orderRow.platformFeeFen, orderRow.developerPayableFen, orderRow.developerUserId,
              sale.id AS saleId
       FROM ai_direct_payment_orders orderRow
       JOIN ai_direct_agent_sales sale ON sale.paymentOrderId = orderRow.id
       WHERE orderRow.id = ? LIMIT 1 FOR UPDATE`,
      [refund.paymentOrderId],
    );
    const order = orders[0];
    if (
      !order ||
      BigInt(order.grossAmountFen) - BigInt(order.refundedFen) < BigInt(refund.amountFen)
    ) {
      throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, "订单可退金额不足", 409);
    }
    const [revenue] = await connection.query<RowDataPacket[]>(
      `SELECT accountType, status FROM ai_direct_revenue_ledger_entries
       WHERE paymentOrderId = ? AND direction = 'credit' FOR UPDATE`,
      [refund.paymentOrderId],
    );
    if (revenue.some((entry) => entry.status !== "posted")) {
      throw new AiDirectHiringError(
        ErrorCodes.INVALID_TRANSITION,
        "开发者收益已进入结算流程，暂不能退款",
        409,
      );
    }

    const ledger = await applyWalletLedgerChange(connection, {
      entryKey: `refund:${refund.id}`,
      userId: refund.userId,
      entryType: "refund",
      businessType: "payment_order",
      businessId: refund.paymentOrderId,
      availableDeltaFen: BigInt(refund.amountFen),
      actorUserId: input.reviewerUserId,
      reason: refund.reason,
      metadata: { refundId: refund.id },
    });
    const split = splitPaidHiringAmount(BigInt(refund.amountFen));
    await connection.query(
      `INSERT INTO ai_direct_revenue_ledger_entries
       (id, entryKey, saleId, paymentOrderId, accountType, accountOwnerUserId, direction, currency, amountFen, metadata)
       VALUES (?, ?, ?, ?, 'platform_revenue', NULL, 'debit', 'CNY', ?, ?),
              (?, ?, ?, ?, 'developer_payable', ?, 'debit', 'CNY', ?, ?)`,
      [
        randomUUID(),
        `${refund.paymentOrderId}:refund:${refund.id}:platform`,
        order.saleId,
        refund.paymentOrderId,
        split.platformFeeFen,
        JSON.stringify({ refundId: refund.id }),
        randomUUID(),
        `${refund.paymentOrderId}:refund:${refund.id}:developer:${order.developerUserId}`,
        order.saleId,
        refund.paymentOrderId,
        order.developerUserId,
        split.developerPayableFen,
        JSON.stringify({ refundId: refund.id }),
      ],
    );
    await connection.query(
      `UPDATE ai_direct_payment_orders SET refundedFen = refundedFen + ?, updatedAt = NOW(3) WHERE id = ?`,
      [refund.amountFen, refund.paymentOrderId],
    );
    await connection.query(
      `UPDATE ai_direct_agent_sales SET refundedFen = refundedFen + ? WHERE id = ?`,
      [refund.amountFen, order.saleId],
    );
    await connection.query(
      `UPDATE wallet_refund_orders
       SET status = 'completed', reviewedByUserId = ?, reviewNote = ?, walletLedgerEntryId = ?,
           completedAt = NOW(3), updatedAt = NOW(3)
       WHERE id = ? AND status = 'pending'`,
      [input.reviewerUserId, input.reviewNote ?? null, ledger.ledgerEntryId, refund.id],
    );
    await publishOutboxEvent(connection, {
      organizationId: null,
      aggregateType: "wallet_refund",
      aggregateId: refund.id,
      eventType: "wallet.refund.completed.v1",
      payload: {
        paymentOrderId: refund.paymentOrderId,
        userId: refund.userId,
        amountFen: String(refund.amountFen),
      },
    });
    await connection.commit();
    return { id: refund.id, status: "completed" as const };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function listWalletRefunds(
  pool: Pick<Pool, "query">,
  input: { status?: string; limit?: number },
) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, paymentOrderId, userId, amountFen, status, reason, requestedByUserId,
            reviewedByUserId, reviewNote, createdAt, completedAt
     FROM wallet_refund_orders WHERE (? IS NULL OR status = ?)
     ORDER BY createdAt DESC, id DESC LIMIT ?`,
    [input.status ?? null, input.status ?? null, limit],
  );
  return rows.map((row) => ({ ...row, amountFen: BigInt(row.amountFen) }));
}
