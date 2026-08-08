import { randomUUID } from "node:crypto";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { publishOutboxEvent } from "../utils/outbox.js";
import { AiDirectHiringError, ErrorCodes } from "./aiDirectErrors.js";
import { queryAlipayTrade, type AlipayConfig } from "./alipayProvider.js";
import { fulfillPaidHiring } from "./paidHiring.js";

export type PaymentOrderStatus = {
  id: string;
  outTradeNo: string;
  status: string;
  currency: "CNY";
  grossAmountFen: bigint;
  offerId: string | null;
  employmentId: string | null;
  nextReconcileAt: Date | null;
  lastProviderStatus: string | null;
};

const toOrderStatus = (row: RowDataPacket): PaymentOrderStatus => ({
  id: row.id,
  outTradeNo: row.outTradeNo,
  status: row.status,
  currency: "CNY",
  grossAmountFen: BigInt(row.grossAmountFen),
  offerId: row.offerId,
  employmentId: row.employmentId,
  nextReconcileAt: row.nextReconcileAt,
  lastProviderStatus: row.lastProviderStatus,
});

export async function getPaymentOrder(
  pool: Pick<Pool, "query">,
  orderId: string,
  requesterUserId: string,
): Promise<PaymentOrderStatus> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT po.id, po.outTradeNo, po.status, po.currency, po.grossAmountFen, po.offerId, po.employmentId,
            po.nextReconcileAt, po.lastProviderStatus
     FROM ai_direct_payment_orders po JOIN ai_direct_hiring_intents hi ON hi.id = po.hiringIntentId
     WHERE po.id = ? AND hi.requestedByUserId = ? LIMIT 1`,
    [orderId, requesterUserId],
  );
  if (!rows[0]) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "支付订单不存在", 404);
  return toOrderStatus(rows[0]);
}

export async function reconcilePaymentOrder(
  pool: Pick<Pool, "getConnection" | "query">,
  config: AlipayConfig,
  input: { orderId: string; requesterUserId: string; minIntervalMs?: number },
): Promise<PaymentOrderStatus> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT po.id, po.outTradeNo, po.status, po.currency, po.grossAmountFen, po.offerId, po.employmentId,
              po.nextReconcileAt, po.lastProviderStatus, po.lastReconciledAt
       FROM ai_direct_payment_orders po JOIN ai_direct_hiring_intents hi ON hi.id = po.hiringIntentId
       WHERE po.id = ? AND hi.requestedByUserId = ? LIMIT 1 FOR UPDATE`,
      [input.orderId, input.requesterUserId],
    );
    const row = rows[0];
    if (!row) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "支付订单不存在", 404);
    if (row.status !== "pending") {
      await connection.commit();
      return toOrderStatus(row);
    }
    const cooldown = input.minIntervalMs ?? 30_000;
    if (row.lastReconciledAt && Date.now() - new Date(row.lastReconciledAt).getTime() < cooldown) {
      throw new AiDirectHiringError(
        ErrorCodes.INVALID_TRANSITION,
        "订单对账冷却中，请稍后重试",
        429,
      );
    }
    await connection.query(
      "UPDATE ai_direct_payment_orders SET lastReconciledAt = NOW(3), reconcileAttemptCount = reconcileAttemptCount + 1 WHERE id = ?",
      [row.id],
    );
    await connection.commit();
    const result = await queryAlipayTrade(config, row.outTradeNo);
    if (result.totalAmountFen !== null && result.totalAmountFen !== BigInt(row.grossAmountFen)) {
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "支付宝查询金额与订单不一致", 400);
    }
    if (
      ["TRADE_SUCCESS", "TRADE_FINISHED"].includes(result.tradeStatus) &&
      result.tradeNo &&
      result.totalAmountFen !== null
    ) {
      await fulfillPaidHiring(pool, {
        outTradeNo: row.outTradeNo,
        tradeNo: result.tradeNo,
        totalAmountFen: result.totalAmountFen,
        rawNotifySha256: `query:${result.tradeNo}`,
      });
    } else {
      const closed = result.tradeStatus === "TRADE_CLOSED";
      await pool.query(
        `UPDATE ai_direct_payment_orders SET lastProviderStatus = ?, lastReconcileErrorCode = NULL,
         nextReconcileAt = DATE_ADD(NOW(3), INTERVAL ? SECOND), status = IF(? AND status = 'pending', 'closed', status)
         WHERE id = ?`,
        [result.tradeStatus, closed ? 0 : 60, closed ? 1 : 0, row.id],
      );
    }
    return getPaymentOrder(pool, input.orderId, input.requesterUserId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export type ReconciliationTradeQuery = (
  config: AlipayConfig,
  outTradeNo: string,
) => ReturnType<typeof queryAlipayTrade>;

export async function reconcileDuePaymentOrders(
  pool: Pick<Pool, "getConnection" | "query">,
  config: AlipayConfig,
  workerId: string,
  limit = 10,
  queryTrade: ReconciliationTradeQuery = queryAlipayTrade,
): Promise<number> {
  const connection = await pool.getConnection();
  let candidates: RowDataPacket[] = [];
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT id, outTradeNo, grossAmountFen, reconcileAttemptCount, reconcileLeaseExpiresAt
       FROM ai_direct_payment_orders
       WHERE status = 'pending' AND (nextReconcileAt IS NULL OR nextReconcileAt <= NOW(3))
         AND (reconcileLeaseExpiresAt IS NULL OR reconcileLeaseExpiresAt < NOW(3))
       ORDER BY COALESCE(nextReconcileAt, createdAt) ASC, id ASC
       LIMIT ? FOR UPDATE SKIP LOCKED`,
      [Math.min(Math.max(limit, 1), 20)],
    );
    candidates = rows;
    if (candidates.length > 0) {
      const ids = candidates.map(() => "?").join(",");
      await connection.query(
        `UPDATE ai_direct_payment_orders
         SET reconcileLeaseOwner = ?, reconcileLeaseExpiresAt = DATE_ADD(NOW(3), INTERVAL 90 SECOND),
             reconcileAttemptCount = reconcileAttemptCount + 1, lastReconciledAt = NOW(3)
         WHERE id IN (${ids})`,
        [workerId, ...candidates.map((row) => row.id)],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  for (const candidate of candidates) {
    if (candidate.reconcileLeaseExpiresAt)
      await recordOperationalAlert(pool, candidate.id, "reconciliation_lease_expired");
    try {
      const result = await queryTrade(config, candidate.outTradeNo);
      if (
        result.totalAmountFen !== null &&
        result.totalAmountFen !== BigInt(candidate.grossAmountFen)
      ) {
        throw new AiDirectHiringError(
          ErrorCodes.VALIDATION_ERROR,
          "支付宝查询金额与订单不一致",
          400,
        );
      }
      if (
        ["TRADE_SUCCESS", "TRADE_FINISHED"].includes(result.tradeStatus) &&
        result.tradeNo &&
        result.totalAmountFen !== null
      ) {
        await fulfillPaidHiring(pool, {
          outTradeNo: candidate.outTradeNo,
          tradeNo: result.tradeNo,
          totalAmountFen: result.totalAmountFen,
          rawNotifySha256: `query:${result.tradeNo}`,
        });
      }
      const closed = result.tradeStatus === "TRADE_CLOSED";
      if (closed) await recordOperationalAlert(pool, candidate.id, "provider_trade_closed");
      await pool.query(
        `UPDATE ai_direct_payment_orders
         SET lastProviderStatus = ?, lastReconcileErrorCode = NULL, reconcileLeaseOwner = NULL, reconcileLeaseExpiresAt = NULL,
             nextReconcileAt = IF(? AND status = 'pending', NULL, DATE_ADD(NOW(3), INTERVAL 60 SECOND)),
             status = IF(? AND status = 'pending', 'closed', status)
         WHERE id = ? AND reconcileLeaseOwner = ?`,
        [result.tradeStatus, closed ? 1 : 0, closed ? 1 : 0, candidate.id, workerId],
      );
    } catch (error) {
      const errorCode =
        error instanceof AiDirectHiringError ? error.code : ErrorCodes.INTERNAL_ERROR;
      const attempts = Number(candidate.reconcileAttemptCount) + 1;
      const delaySeconds = Math.min(3600, 30 * 2 ** Math.min(attempts, 6));
      await recordOperationalAlert(
        pool,
        candidate.id,
        attempts >= 7 ? "reconciliation_retry_exhausted" : `reconciliation_failed:${errorCode}`,
        attempts >= 7 ? "error" : "warning",
      );
      await pool.query(
        `UPDATE ai_direct_payment_orders
         SET lastReconcileErrorCode = ?, reconcileLeaseOwner = NULL, reconcileLeaseExpiresAt = NULL,
             nextReconcileAt = DATE_ADD(NOW(3), INTERVAL ? SECOND)
         WHERE id = ? AND reconcileLeaseOwner = ?`,
        [errorCode, delaySeconds, candidate.id, workerId],
      );
    }
  }
  return candidates.length;
}

async function recordOperationalAlert(
  pool: Pick<Pool, "query">,
  paymentOrderId: string,
  code: string,
  severity: "warning" | "error" = "warning",
): Promise<void> {
  await pool.query(
    `INSERT INTO ai_direct_paid_hiring_operational_alerts
     (id, paymentOrderId, code, severity, status, occurrenceCount, firstObservedAt, lastObservedAt)
     VALUES (?, ?, ?, ?, 'open', 1, NOW(3), NOW(3))
     ON DUPLICATE KEY UPDATE occurrenceCount = occurrenceCount + 1, severity = VALUES(severity),
       status = 'open', resolvedAt = NULL, lastObservedAt = NOW(3)`,
    [randomUUID(), paymentOrderId, code, severity],
  );
}

export type SettlementPage<T> = { items: T[]; nextCursor: string | null };

const decodeCursor = (value?: string): { createdAt: string; id: string } | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      createdAt?: string;
      id?: string;
    };
    return typeof parsed.createdAt === "string" && typeof parsed.id === "string"
      ? { createdAt: parsed.createdAt, id: parsed.id }
      : null;
  } catch {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "cursor 无效");
  }
};

const encodeCursor = (row: { createdAt: Date; id: string }): string =>
  Buffer.from(JSON.stringify({ createdAt: row.createdAt.toISOString(), id: row.id })).toString(
    "base64url",
  );

export async function listDeveloperPayableBalances(
  pool: Pick<Pool, "query">,
  input: { limit?: number; cursor?: string },
): Promise<SettlementPage<{ developerUserId: string; currency: "CNY"; payableFen: bigint }>> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const cursor = input.cursor ? Buffer.from(input.cursor, "base64url").toString("utf8") : null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT accountOwnerUserId AS developerUserId, currency, SUM(amountFen) AS payableFen, MAX(createdAt) AS createdAt
     FROM ai_direct_revenue_ledger_entries
     WHERE accountType = 'developer_payable' AND status = 'posted'
     GROUP BY accountOwnerUserId, currency
     HAVING (? IS NULL OR accountOwnerUserId > ?)
     ORDER BY accountOwnerUserId ASC LIMIT ?`,
    [cursor, cursor, limit + 1],
  );
  const page = rows.slice(0, limit).map((row) => ({
    developerUserId: row.developerUserId,
    currency: "CNY" as const,
    payableFen: BigInt(row.payableFen),
  }));
  const last = rows[limit - 1];
  return {
    items: page,
    nextCursor:
      rows.length > limit && last ? Buffer.from(last.developerUserId).toString("base64url") : null,
  };
}

export async function listSettleableLedgerEntries(
  pool: Pick<Pool, "query">,
  input: { developerUserId: string; limit?: number; cursor?: string },
): Promise<
  SettlementPage<{ id: string; paymentOrderId: string; amountFen: bigint; createdAt: Date }>
> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const cursor = decodeCursor(input.cursor);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, paymentOrderId, amountFen, createdAt FROM ai_direct_revenue_ledger_entries
     WHERE accountType = 'developer_payable' AND accountOwnerUserId = ? AND status = 'posted'
       AND (? IS NULL OR createdAt < ? OR (createdAt = ? AND id < ?))
     ORDER BY createdAt DESC, id DESC LIMIT ?`,
    [
      input.developerUserId,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      limit + 1,
    ],
  );
  const items = rows.slice(0, limit).map((row) => ({
    id: row.id,
    paymentOrderId: row.paymentOrderId,
    amountFen: BigInt(row.amountFen),
    createdAt: row.createdAt,
  }));
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last) : null };
}

export async function listDeveloperSettlements(
  pool: Pick<Pool, "query">,
  input: { developerUserId?: string; status?: string; limit?: number; cursor?: string },
): Promise<
  SettlementPage<{
    id: string;
    developerUserId: string;
    currency: "CNY";
    amountFen: bigint;
    status: string;
    createdAt: Date;
  }>
> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const cursor = decodeCursor(input.cursor);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, developerUserId, currency, amountFen, status, createdAt FROM ai_direct_developer_settlements
     WHERE (? IS NULL OR developerUserId = ?) AND (? IS NULL OR status = ?)
       AND (? IS NULL OR createdAt < ? OR (createdAt = ? AND id < ?))
     ORDER BY createdAt DESC, id DESC LIMIT ?`,
    [
      input.developerUserId ?? null,
      input.developerUserId ?? null,
      input.status ?? null,
      input.status ?? null,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      limit + 1,
    ],
  );
  const items = rows.slice(0, limit).map((row) => ({
    id: row.id,
    developerUserId: row.developerUserId,
    currency: "CNY" as const,
    amountFen: BigInt(row.amountFen),
    status: row.status,
    createdAt: row.createdAt,
  }));
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last) : null };
}

export async function getDeveloperSettlement(
  pool: Pick<Pool, "query">,
  settlementId: string,
): Promise<{
  id: string;
  developerUserId: string;
  currency: "CNY";
  amountFen: bigint;
  status: string;
  externalReference: string | null;
  failureReason: string | null;
  items: Array<{ ledgerEntryId: string; amountFen: bigint }>;
}> {
  const [settlements] = await pool.query<RowDataPacket[]>(
    "SELECT id, developerUserId, currency, amountFen, status, externalReference, failureReason FROM ai_direct_developer_settlements WHERE id = ? LIMIT 1",
    [settlementId],
  );
  const settlement = settlements[0];
  if (!settlement) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "结算批次不存在", 404);
  const [items] = await pool.query<RowDataPacket[]>(
    "SELECT ledgerEntryId, amountFen FROM ai_direct_developer_settlement_items WHERE settlementId = ? ORDER BY ledgerEntryId",
    [settlementId],
  );
  return {
    id: settlement.id,
    developerUserId: settlement.developerUserId,
    currency: "CNY",
    amountFen: BigInt(settlement.amountFen),
    status: settlement.status,
    externalReference: settlement.externalReference,
    failureReason: settlement.failureReason,
    items: items.map((item) => ({
      ledgerEntryId: item.ledgerEntryId,
      amountFen: BigInt(item.amountFen),
    })),
  };
}

export async function listOperationalAlerts(
  pool: Pick<Pool, "query">,
  input: { status?: "open" | "resolved"; limit?: number; cursor?: string },
): Promise<
  SettlementPage<{
    id: string;
    paymentOrderId: string;
    code: string;
    severity: "warning" | "error";
    occurrenceCount: number;
    lastObservedAt: Date;
  }>
> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const cursor = decodeCursor(input.cursor);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, paymentOrderId, code, severity, occurrenceCount, lastObservedAt
     FROM ai_direct_paid_hiring_operational_alerts
     WHERE (? IS NULL OR status = ?)
       AND (? IS NULL OR lastObservedAt < ? OR (lastObservedAt = ? AND id < ?))
     ORDER BY lastObservedAt DESC, id DESC LIMIT ?`,
    [
      input.status ?? null,
      input.status ?? null,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      limit + 1,
    ],
  );
  const items = rows.slice(0, limit).map((row) => ({
    id: row.id,
    paymentOrderId: row.paymentOrderId,
    code: row.code,
    severity: row.severity === "error" ? ("error" as const) : ("warning" as const),
    occurrenceCount: Number(row.occurrenceCount),
    lastObservedAt: row.lastObservedAt,
  }));
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ createdAt: last.lastObservedAt, id: last.id })
        : null,
  };
}

export async function createDeveloperSettlement(
  pool: Pick<Pool, "getConnection">,
  input: { developerUserId: string; ledgerEntryIds: string[]; createdByUserId: string },
): Promise<{ id: string; amountFen: bigint; currency: "CNY"; status: "pending" }> {
  if (input.ledgerEntryIds.length === 0)
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "结算至少选择一条分录");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const marks = input.ledgerEntryIds.map(() => "?").join(",");
    const [entries] = await connection.query<RowDataPacket[]>(
      `SELECT id, amountFen, currency FROM ai_direct_revenue_ledger_entries
       WHERE id IN (${marks}) AND accountType = 'developer_payable' AND accountOwnerUserId = ? AND status = 'posted'
       FOR UPDATE`,
      [...input.ledgerEntryIds, input.developerUserId],
    );
    if (
      entries.length !== input.ledgerEntryIds.length ||
      entries.some((entry) => entry.currency !== "CNY")
    ) {
      throw new AiDirectHiringError(
        ErrorCodes.INVALID_TRANSITION,
        "分录不可结算、已被占用或币种不一致",
        409,
      );
    }
    const amountFen = entries.reduce((sum, entry) => sum + BigInt(entry.amountFen), 0n);
    const id = randomUUID();
    await connection.query(
      `INSERT INTO ai_direct_developer_settlements (id, developerUserId, currency, amountFen, status, createdByUserId)
       VALUES (?, ?, 'CNY', ?, 'pending', ?)`,
      [id, input.developerUserId, amountFen, input.createdByUserId],
    );
    for (const entry of entries) {
      await connection.query(
        "INSERT INTO ai_direct_developer_settlement_items (settlementId, ledgerEntryId, amountFen) VALUES (?, ?, ?)",
        [id, entry.id, entry.amountFen],
      );
    }
    await connection.query(
      `UPDATE ai_direct_revenue_ledger_entries SET status = 'settlement_pending' WHERE id IN (${marks})`,
      input.ledgerEntryIds,
    );
    await connection.query(
      `INSERT INTO ai_direct_audit_events (id, actorUserId, action, targetType, targetId, outcome, metadata)
       VALUES (?, ?, 'paid_hiring.settlement.created', 'developer_settlement', ?, 'success', ?)`,
      [
        randomUUID(),
        input.createdByUserId,
        id,
        JSON.stringify({
          developerUserId: input.developerUserId,
          amountFen: String(amountFen),
          entryCount: entries.length,
        }),
      ],
    );
    await publishOutboxEvent(connection, {
      organizationId: null,
      aggregateType: "developer_settlement",
      aggregateId: id,
      eventType: "paid_hiring.settlement.created.v1",
      payload: {
        developerUserId: input.developerUserId,
        amountFen: String(amountFen),
        currency: "CNY",
        entryCount: entries.length,
      },
    });
    await connection.commit();
    return { id, amountFen, currency: "CNY", status: "pending" };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function transitionDeveloperSettlement(
  pool: Pick<Pool, "getConnection">,
  input: {
    settlementId: string;
    actorUserId: string;
    action: "processing" | "failed" | "retry" | "completed";
    externalReference?: string;
    failureReason?: string;
  },
): Promise<void> {
  if (input.action === "completed" && !input.externalReference?.trim())
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "完成人工结算必须提供外部参考号");
  if (input.action === "failed" && !input.failureReason?.trim())
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "标记结算失败必须提供原因");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT id, status FROM ai_direct_developer_settlements WHERE id = ? LIMIT 1 FOR UPDATE",
      [input.settlementId],
    );
    const settlement = rows[0];
    const expected = {
      processing: "pending",
      completed: "processing",
      failed: "processing",
      retry: "failed",
    } as const;
    if (!settlement || settlement.status !== expected[input.action])
      throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, "结算状态不允许该操作", 409);
    const updates: Record<typeof input.action, [string, string[]]> = {
      processing: [
        "UPDATE ai_direct_developer_settlements SET status = 'processing', processingByUserId = ?, processingAt = NOW(3), failureReason = NULL WHERE id = ?",
        [input.actorUserId, input.settlementId],
      ],
      retry: [
        "UPDATE ai_direct_developer_settlements SET status = 'processing', processingByUserId = ?, processingAt = NOW(3), failureReason = NULL WHERE id = ?",
        [input.actorUserId, input.settlementId],
      ],
      failed: [
        "UPDATE ai_direct_developer_settlements SET status = 'failed', failureReason = ?, processingByUserId = NULL WHERE id = ?",
        [input.failureReason!.trim().slice(0, 512), input.settlementId],
      ],
      completed: [
        "UPDATE ai_direct_developer_settlements SET status = 'completed', externalReference = ?, completedByUserId = ?, completedAt = NOW(3) WHERE id = ?",
        [input.externalReference!.trim().slice(0, 191), input.actorUserId, input.settlementId],
      ],
    };
    const [sql, parameters] = updates[input.action];
    await connection.query(sql, parameters);
    if (input.action === "completed")
      await connection.query(
        `UPDATE ai_direct_revenue_ledger_entries l JOIN ai_direct_developer_settlement_items i ON i.ledgerEntryId = l.id
       SET l.status = 'settled' WHERE i.settlementId = ?`,
        [input.settlementId],
      );
    await connection.query(
      `INSERT INTO ai_direct_audit_events (id, actorUserId, action, targetType, targetId, outcome, metadata)
       VALUES (?, ?, ?, 'developer_settlement', ?, 'success', ?)`,
      [
        randomUUID(),
        input.actorUserId,
        `paid_hiring.settlement.${input.action}`,
        input.settlementId,
        JSON.stringify({
          failureReason:
            input.action === "failed" ? input.failureReason!.trim().slice(0, 512) : undefined,
        }),
      ],
    );
    await publishOutboxEvent(connection, {
      organizationId: null,
      aggregateType: "developer_settlement",
      aggregateId: input.settlementId,
      eventType: `paid_hiring.settlement.${input.action}.v1`,
      payload: { action: input.action },
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
