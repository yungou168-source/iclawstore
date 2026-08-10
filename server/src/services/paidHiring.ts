import { randomUUID } from "node:crypto";
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { publishOutboxEvent } from "../utils/outbox.js";
import { completeAgentSale } from "./agentSales.js";
import { AiDirectHiringError, ErrorCodes } from "./aiDirectErrors.js";
import { applyWalletLedgerChange } from "./walletLedger.js";

export type PaidHiringNotification = {
  outTradeNo: string;
  tradeNo: string;
  totalAmountFen: bigint;
  rawNotifySha256: string;
};

export type PaidHiringResult = {
  paymentOrderId: string;
  offerId: string;
  employmentId: string;
  employmentStatus: "onboarding";
  replayed: boolean;
};

type FulfillmentRow = RowDataPacket & {
  id: string;
  status: string;
  providerTradeNo: string | null;
  grossAmountFen: bigint;
  platformFeeFen: bigint;
  developerPayableFen: bigint;
  developerUserId: string;
  offerId: string | null;
  employmentId: string | null;
  hiringIntentId: string;
  organizationId: string;
  companyId: string;
  projectId: string | null;
  roleId: string;
  positionId: string;
  agentId: string;
  agentVersionId: string;
  requestedByUserId: string;
  intentStatus: string;
  priceId: string;
  priceVersion: number;
};

async function writeAudit(
  connection: PoolConnection,
  row: FulfillmentRow,
  notification: PaidHiringNotification,
  offerId: string,
  employmentId: string,
): Promise<void> {
  await connection.query(
    `INSERT INTO ai_direct_audit_events
     (id, organizationId, actorUserId, action, targetType, targetId, requestId, outcome, metadata)
     VALUES (?, ?, NULL, 'paid_hiring.fulfilled', 'payment_order', ?, ?, 'success', ?)`,
    [
      randomUUID(),
      row.organizationId,
      row.id,
      `alipay:${notification.tradeNo}`,
      JSON.stringify({ offerId, employmentId, grossAmountFen: String(row.grossAmountFen) }),
    ],
  );
}

async function lockFulfillmentRow(
  connection: PoolConnection,
  outTradeNo: string,
): Promise<FulfillmentRow> {
  const [rows] = await connection.query<FulfillmentRow[]>(
    `SELECT po.id, po.status, po.providerTradeNo, po.grossAmountFen, po.platformFeeFen, po.developerPayableFen,
            po.developerUserId, po.offerId, po.employmentId, po.hiringIntentId,
            hi.organizationId, hi.companyId, hi.projectId, hi.roleId, hi.positionId, hi.agentId,
            hi.agentVersionId, hi.requestedByUserId, hi.status AS intentStatus,
            po.priceId, po.priceVersion
     FROM ai_direct_payment_orders po
     JOIN ai_direct_hiring_intents hi ON hi.id = po.hiringIntentId
     WHERE po.outTradeNo = ? LIMIT 1 FOR UPDATE`,
    [outTradeNo],
  );
  const row = rows[0];
  if (!row) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "支付订单不存在", 404);
  return row;
}

export async function fulfillPaidHiring(
  pool: Pick<Pool, "getConnection">,
  notification: PaidHiringNotification,
  walletPayerUserId?: string,
): Promise<PaidHiringResult> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const row = await lockFulfillmentRow(connection, notification.outTradeNo);
    if (BigInt(row.grossAmountFen) !== notification.totalAmountFen) {
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "支付宝实付金额与订单不一致", 400);
    }
    if (row.status === "fulfilled" && row.offerId && row.employmentId) {
      if (row.providerTradeNo !== notification.tradeNo) {
        throw new AiDirectHiringError(
          ErrorCodes.VALIDATION_ERROR,
          "支付宝交易号与已履约订单不一致",
          400,
        );
      }
      await connection.commit();
      return {
        paymentOrderId: row.id,
        offerId: row.offerId,
        employmentId: row.employmentId,
        employmentStatus: "onboarding",
        replayed: true,
      };
    }
    if (row.status !== "pending" || row.intentStatus !== "awaiting_payment") {
      throw new AiDirectHiringError(
        ErrorCodes.INVALID_TRANSITION,
        "支付订单或雇佣意图状态不允许履约",
        409,
      );
    }

    let walletLedgerEntryId: string | null = null;
    if (walletPayerUserId) {
      const wallet = await applyWalletLedgerChange(connection, {
        entryKey: `paid-hiring:${row.id}`,
        userId: walletPayerUserId,
        entryType: "consume",
        businessType: "paid_hiring_order",
        businessId: row.id,
        availableDeltaFen: -BigInt(row.grossAmountFen),
        actorUserId: walletPayerUserId,
        metadata: { hiringIntentId: row.hiringIntentId, agentId: row.agentId },
      });
      walletLedgerEntryId = wallet.ledgerEntryId;
    }

    const sale = await completeAgentSale(connection, {
      hiringIntentId: row.hiringIntentId,
      paymentOrderId: row.id,
      organizationId: row.organizationId,
      companyId: row.companyId,
      projectId: row.projectId,
      roleId: row.roleId,
      positionId: row.positionId,
      agentId: row.agentId,
      agentVersionId: row.agentVersionId,
      requestedByUserId: row.requestedByUserId,
      developerUserId: row.developerUserId,
      priceId: row.priceId,
      priceVersion: row.priceVersion,
      pricingMode: "paid",
      grossAmountFen: BigInt(row.grossAmountFen),
      platformRevenueFen: BigInt(row.platformFeeFen),
      developerRevenueFen: BigInt(row.developerPayableFen),
    });
    const { offerId, employmentId } = sale;
    const [intentUpdate] = await connection.query<ResultSetHeader>(
      `UPDATE ai_direct_hiring_intents SET status = 'hired', updatedAt = NOW(3)
       WHERE id = ? AND status = 'awaiting_payment'`,
      [row.hiringIntentId],
    );
    if (intentUpdate.affectedRows !== 1) {
      throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, "雇佣意图已被并发处理", 409);
    }
    const [orderUpdate] = await connection.query<ResultSetHeader>(
      `UPDATE ai_direct_payment_orders
       SET status = 'fulfilled', provider = ?, providerTradeNo = ?, rawNotifySha256 = ?, paidAt = NOW(3),
           fulfilledAt = NOW(3), offerId = ?, employmentId = ?, payerUserId = ?,
           walletLedgerEntryId = ?, updatedAt = NOW(3)
       WHERE id = ? AND status = 'pending'`,
      [
        walletPayerUserId ? "wallet" : "alipay",
        notification.tradeNo,
        notification.rawNotifySha256,
        offerId,
        employmentId,
        walletPayerUserId ?? null,
        walletLedgerEntryId,
        row.id,
      ],
    );
    if (orderUpdate.affectedRows !== 1) {
      throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, "支付订单已被并发处理", 409);
    }

    await writeAudit(connection, row, notification, offerId, employmentId);
    await publishOutboxEvent(connection, {
      organizationId: row.organizationId,
      aggregateType: "payment_order",
      aggregateId: row.id,
      eventType: "paid_hiring.fulfilled.v1",
      payload: {
        paymentOrderId: row.id,
        saleId: sale.saleId,
        offerId,
        employmentId,
        companyId: row.companyId,
        agentId: row.agentId,
        developerUserId: row.developerUserId,
        grossAmountFen: String(row.grossAmountFen),
        platformFeeFen: String(row.platformFeeFen),
        developerPayableFen: String(row.developerPayableFen),
      },
    });
    await connection.commit();
    return {
      paymentOrderId: row.id,
      offerId,
      employmentId,
      employmentStatus: "onboarding",
      replayed: false,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
