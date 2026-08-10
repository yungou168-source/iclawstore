import { randomUUID } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { publishOutboxEvent } from "../utils/outbox.js";
import { completeAgentSale } from "./agentSales.js";
import { AiDirectHiringError, ErrorCodes } from "./aiDirectErrors.js";
import { loadHiringContext, type CreatePaidHiringOrderInput } from "./paidHiringOrder.js";

export type FreeHiringResult = {
  id: string;
  saleId: string;
  saleNo: string;
  hiringIntentId: string;
  provider: "free";
  status: "fulfilled";
  currency: "CNY";
  grossAmountFen: 0n;
  platformFeeFen: 0n;
  developerPayableFen: 0n;
  offerId: string;
  employmentId: string;
  replayed: boolean;
};

export async function isFreeHiringRequest(
  pool: Pick<Pool, "query">,
  input: Pick<CreatePaidHiringOrderInput, "companyId" | "roleId" | "positionId" | "agentId">,
): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT price.amountFen
     FROM ai_direct_companies company
     JOIN ai_direct_agent_roles role ON role.id = ? AND role.companyId = company.id
     JOIN ai_direct_position_agent_roles binding ON binding.roleId = role.id AND binding.positionId = ?
     JOIN ai_direct_agents agent ON agent.id = ? AND agent.activeVersionId IS NOT NULL
     JOIN ai_direct_agent_prices price ON price.agentId = agent.id
       AND price.agentVersionId = agent.activeVersionId AND price.status = 'active'
     WHERE company.id = ? LIMIT 1`,
    [input.roleId, input.positionId, input.agentId, input.companyId],
  );
  return rows[0] !== undefined && BigInt(rows[0].amountFen) === 0n;
}

export async function createFreeHiringSale(
  pool: Pick<Pool, "getConnection">,
  input: CreatePaidHiringOrderInput,
): Promise<FreeHiringResult> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existingRows] = await connection.query<RowDataPacket[]>(
      `SELECT intent.id AS hiringIntentId, intent.idempotencyFingerprint,
              sale.id AS saleId, sale.saleNo, sale.offerId, sale.employmentId
       FROM ai_direct_hiring_intents intent
       LEFT JOIN ai_direct_agent_sales sale ON sale.hiringIntentId = intent.id
       WHERE intent.requestedByUserId = ? AND intent.idempotencyKey = ?
       LIMIT 1 FOR UPDATE`,
      [input.requestedByUserId, input.idempotencyKey],
    );
    const existing = existingRows[0];
    if (existing) {
      if (existing.idempotencyFingerprint !== input.idempotencyFingerprint) {
        throw new AiDirectHiringError(
          ErrorCodes.IDEMPOTENCY_KEY_REUSED,
          "幂等键已用于不同的雇佣请求",
          409,
        );
      }
      if (!existing.saleId) {
        throw new AiDirectHiringError(
          ErrorCodes.INVALID_TRANSITION,
          "该幂等请求尚未形成免费出售记录",
          409,
        );
      }
      await connection.commit();
      return {
        id: existing.saleId,
        saleId: existing.saleId,
        saleNo: existing.saleNo,
        hiringIntentId: existing.hiringIntentId,
        provider: "free",
        status: "fulfilled",
        currency: "CNY",
        grossAmountFen: 0n,
        platformFeeFen: 0n,
        developerPayableFen: 0n,
        offerId: existing.offerId,
        employmentId: existing.employmentId,
        replayed: true,
      };
    }

    const context = await loadHiringContext(connection, input);
    if (BigInt(context.amountFen) !== 0n) {
      throw new AiDirectHiringError(
        ErrorCodes.INVALID_TRANSITION,
        "当前 Agent 价格不是免费价格，请重新发起招聘",
        409,
      );
    }
    const hiringIntentId = randomUUID();
    await connection.query(
      `INSERT INTO ai_direct_hiring_intents
       (id, organizationId, companyId, projectId, roleId, positionId, agentId, agentVersionId,
        priceId, requestedByUserId, status, idempotencyKey, idempotencyFingerprint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_payment', ?, ?)`,
      [
        hiringIntentId,
        context.organizationId,
        context.companyId,
        context.projectId,
        context.roleId,
        context.positionId,
        context.agentId,
        context.agentVersionId,
        context.priceId,
        input.requestedByUserId,
        input.idempotencyKey,
        input.idempotencyFingerprint,
      ],
    );
    const sale = await completeAgentSale(connection, {
      hiringIntentId,
      paymentOrderId: null,
      organizationId: context.organizationId,
      companyId: context.companyId,
      projectId: context.projectId,
      roleId: context.roleId,
      positionId: context.positionId,
      agentId: context.agentId,
      agentVersionId: context.agentVersionId,
      requestedByUserId: input.requestedByUserId,
      developerUserId: context.developerUserId,
      priceId: context.priceId,
      priceVersion: context.priceVersion,
      pricingMode: "free",
      grossAmountFen: 0n,
      platformRevenueFen: 0n,
      developerRevenueFen: 0n,
    });
    await connection.query(
      `UPDATE ai_direct_hiring_intents SET status = 'hired', updatedAt = NOW(3)
       WHERE id = ? AND status = 'awaiting_payment'`,
      [hiringIntentId],
    );
    await connection.query(
      `INSERT INTO ai_direct_audit_events
       (id, organizationId, actorUserId, action, targetType, targetId, requestId, outcome, metadata)
       VALUES (?, ?, ?, 'agent_sale.free.completed', 'agent_sale', ?, ?, 'success', ?)`,
      [
        randomUUID(),
        context.organizationId,
        input.requestedByUserId,
        sale.saleId,
        input.requestId,
        JSON.stringify({
          hiringIntentId,
          employmentId: sale.employmentId,
          offerId: sale.offerId,
          agentId: context.agentId,
        }),
      ],
    );
    await publishOutboxEvent(connection, {
      organizationId: context.organizationId,
      aggregateType: "hiring_intent",
      aggregateId: hiringIntentId,
      eventType: "free_hiring.fulfilled.v1",
      payload: {
        saleId: sale.saleId,
        hiringIntentId,
        employmentId: sale.employmentId,
        offerId: sale.offerId,
      },
    });
    await connection.commit();
    return {
      id: sale.saleId,
      saleId: sale.saleId,
      saleNo: sale.saleNo,
      hiringIntentId,
      provider: "free",
      status: "fulfilled",
      currency: "CNY",
      grossAmountFen: 0n,
      platformFeeFen: 0n,
      developerPayableFen: 0n,
      offerId: sale.offerId,
      employmentId: sale.employmentId,
      replayed: false,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
