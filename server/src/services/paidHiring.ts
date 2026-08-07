import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { publishOutboxEvent } from '../utils/outbox.js';
import { AiDirectHiringError, ErrorCodes } from './aiDirectErrors.js';
import { synchronizeWorkforceEmployeeDigest } from './workforceEmployeeDigestSync.js';

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
  employmentStatus: 'onboarding';
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
  if (!row) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, '支付订单不存在', 404);
  return row;
}

export async function fulfillPaidHiring(
  pool: Pick<Pool, 'getConnection'>,
  notification: PaidHiringNotification,
): Promise<PaidHiringResult> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const row = await lockFulfillmentRow(connection, notification.outTradeNo);
    if (BigInt(row.grossAmountFen) !== notification.totalAmountFen) {
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '支付宝实付金额与订单不一致', 400);
    }
    if (row.status === 'fulfilled' && row.offerId && row.employmentId) {
      if (row.providerTradeNo !== notification.tradeNo) {
        throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '支付宝交易号与已履约订单不一致', 400);
      }
      await connection.commit();
      return {
        paymentOrderId: row.id,
        offerId: row.offerId,
        employmentId: row.employmentId,
        employmentStatus: 'onboarding',
        replayed: true,
      };
    }
    if (row.status !== 'pending' || row.intentStatus !== 'awaiting_payment') {
      throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, '支付订单或雇佣意图状态不允许履约', 409);
    }

    const [positionRows] = await connection.query<RowDataPacket[]>(
      `SELECT p.id, p.status
       FROM ai_direct_positions p
       JOIN ai_direct_departments d ON d.id = p.departmentId
       JOIN ai_direct_position_agent_roles pr ON pr.positionId = p.id AND pr.roleId = ?
       WHERE p.id = ? AND d.companyId = ? AND d.status = 'active'
       LIMIT 1 FOR UPDATE`,
      [row.roleId, row.positionId, row.companyId],
    );
    const position = positionRows[0];
    if (!position || position.status !== 'open') {
      throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, '付款成功时对应 Position 已不可雇佣', 409);
    }
    const [headcount] = await connection.query<ResultSetHeader>(
      `UPDATE ai_direct_positions
       SET headcountFilled = headcountFilled + 1, updatedAt = NOW(3)
       WHERE id = ? AND headcountFilled < headcountTarget`,
      [position.id],
    );
    if (headcount.affectedRows !== 1) {
      throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, '付款成功时 Position 编制已满', 409);
    }

    await connection.query('SELECT id FROM ai_direct_agents WHERE id = ? LIMIT 1 FOR UPDATE', [row.agentId]);
    const [profileRows] = await connection.query<RowDataPacket[]>(
      `SELECT controllerEmploymentId FROM ai_direct_agent_appearance_profiles
       WHERE agentId = ? LIMIT 1 FOR UPDATE`,
      [row.agentId],
    );
    if (profileRows[0]?.controllerEmploymentId) {
      throw new AiDirectHiringError(ErrorCodes.APPEARANCE_CONTROL_CONFLICT, '该 Agent 已被另一家公司雇佣', 409);
    }

    const offerId = randomUUID();
    const employmentId = randomUUID();
    await connection.query(
      `INSERT INTO ai_direct_offers
       (id, roleId, agentVersionId, companyId, projectId, status, terms, proposedByUserId,
        proposedAt, paymentOrderId, issuedAt)
       VALUES (?, ?, ?, ?, ?, 'issued', ?, ?, NOW(3), ?, NOW(3))`,
      [
        offerId, row.roleId, row.agentVersionId, row.companyId, row.projectId,
        JSON.stringify({
          currency: 'CNY', grossAmountFen: String(row.grossAmountFen),
          platformFeeFen: String(row.platformFeeFen), developerPayableFen: String(row.developerPayableFen),
          priceId: row.priceId, priceVersion: row.priceVersion,
        }),
        row.requestedByUserId, row.id,
      ],
    );
    await connection.query(
      `INSERT INTO ai_direct_employments
       (id, companyId, agentId, agentVersionId, roleId, projectId, offerId, paymentOrderId,
        requestedByUserId, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'onboarding')`,
      [
        employmentId, row.companyId, row.agentId, row.agentVersionId, row.roleId,
        row.projectId, offerId, row.id, row.requestedByUserId,
      ],
    );
    await connection.query(
      `INSERT INTO ai_direct_agent_appearance_profiles
       (agentId, avatarAssetId, defaultMode, controllerEmploymentId, controllerCompanyId,
        revision, updatedByUserId, createdAt, updatedAt)
       VALUES (?, NULL, 'image_2d', ?, ?, 1, ?, NOW(3), NOW(3))
       ON DUPLICATE KEY UPDATE controllerEmploymentId = VALUES(controllerEmploymentId),
         controllerCompanyId = VALUES(controllerCompanyId), revision = revision + 1,
         updatedByUserId = VALUES(updatedByUserId), updatedAt = NOW(3)`,
      [row.agentId, employmentId, row.companyId, row.requestedByUserId],
    );
    await connection.query(
      `INSERT INTO ai_direct_employment_events
       (id, employmentId, sequence, fromStatus, toStatus, actorUserId, reason, metadata)
       VALUES (?, ?, 1, NULL, 'onboarding', ?, 'Employment created from paid Offer', ?)`,
      [randomUUID(), employmentId, row.requestedByUserId, JSON.stringify({ paymentOrderId: row.id, offerId })],
    );
    await synchronizeWorkforceEmployeeDigest(connection, employmentId);
    await connection.query(
      `INSERT INTO ai_direct_organization_candidate_catalog_counts (organizationId, agentId, isEmployed)
       VALUES (?, ?, TRUE)
       ON DUPLICATE KEY UPDATE isEmployed = TRUE`,
      [row.organizationId, row.agentId],
    );

    await connection.query(
      `INSERT INTO ai_direct_revenue_ledger_entries
       (id, entryKey, paymentOrderId, accountType, accountOwnerUserId, direction, currency, amountFen, metadata)
       VALUES (?, ?, ?, 'platform_revenue', NULL, 'credit', 'CNY', ?, ?),
              (?, ?, ?, 'developer_payable', ?, 'credit', 'CNY', ?, ?)`,
      [
        randomUUID(), `${row.id}:platform_revenue`, row.id, row.platformFeeFen,
        JSON.stringify({ percentage: 20 }),
        randomUUID(), `${row.id}:developer_payable:${row.developerUserId}`, row.id,
        row.developerUserId, row.developerPayableFen, JSON.stringify({ percentage: 80 }),
      ],
    );
    const [intentUpdate] = await connection.query<ResultSetHeader>(
      `UPDATE ai_direct_hiring_intents SET status = 'hired', updatedAt = NOW(3)
       WHERE id = ? AND status = 'awaiting_payment'`,
      [row.hiringIntentId],
    );
    if (intentUpdate.affectedRows !== 1) {
      throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, '雇佣意图已被并发处理', 409);
    }
    const [orderUpdate] = await connection.query<ResultSetHeader>(
      `UPDATE ai_direct_payment_orders
       SET status = 'fulfilled', providerTradeNo = ?, rawNotifySha256 = ?, paidAt = NOW(3),
           fulfilledAt = NOW(3), offerId = ?, employmentId = ?, updatedAt = NOW(3)
       WHERE id = ? AND status = 'pending'`,
      [notification.tradeNo, notification.rawNotifySha256, offerId, employmentId, row.id],
    );
    if (orderUpdate.affectedRows !== 1) {
      throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, '支付订单已被并发处理', 409);
    }

    await writeAudit(connection, row, notification, offerId, employmentId);
    await publishOutboxEvent(connection, {
      organizationId: row.organizationId,
      aggregateType: 'payment_order',
      aggregateId: row.id,
      eventType: 'paid_hiring.fulfilled.v1',
      payload: {
        paymentOrderId: row.id, offerId, employmentId, companyId: row.companyId,
        agentId: row.agentId, developerUserId: row.developerUserId,
        grossAmountFen: String(row.grossAmountFen), platformFeeFen: String(row.platformFeeFen),
        developerPayableFen: String(row.developerPayableFen),
      },
    });
    await connection.commit();
    return { paymentOrderId: row.id, offerId, employmentId, employmentStatus: 'onboarding', replayed: false };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}