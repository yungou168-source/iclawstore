import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { publishOutboxEvent } from "../utils/outbox.js";
import { AiDirectHiringError, ErrorCodes } from "./aiDirectErrors.js";
import { splitPaidHiringAmount } from "./paidHiringMoney.js";

export type CreatePaidHiringOrderInput = {
  companyId: string;
  projectId: string | null;
  roleId: string;
  positionId: string;
  agentId: string;
  requestedByUserId: string;
  idempotencyKey: string;
  idempotencyFingerprint: string;
  requestId: string;
};

export type PaidHiringOrder = {
  id: string;
  outTradeNo: string;
  hiringIntentId: string;
  status: "pending";
  currency: "CNY";
  grossAmountFen: bigint;
  platformFeeFen: bigint;
  developerPayableFen: bigint;
  developerUserId: string;
  agentName: string;
  replayed: boolean;
};

type HiringContextRow = RowDataPacket & {
  organizationId: string;
  companyId: string;
  projectId: string | null;
  roleId: string;
  positionId: string;
  agentId: string;
  agentVersionId: string;
  agentName: string;
  developerUserId: string;
  priceId: string;
  priceVersion: number;
  currency: string;
  amountFen: bigint;
};

type ExistingOrderRow = RowDataPacket &
  Omit<PaidHiringOrder, "replayed" | "status" | "currency"> & {
    status: string;
    currency: string;
    idempotencyFingerprint: string;
  };

const newOutTradeNo = (): string =>
  `AIH${new Date().toISOString().replace(/\D/g, "").slice(0, 17)}${randomBytes(8).toString("hex").toUpperCase()}`;

async function findExistingOrder(
  connection: PoolConnection,
  input: CreatePaidHiringOrderInput,
): Promise<ExistingOrderRow | null> {
  const [rows] = await connection.query<ExistingOrderRow[]>(
    `SELECT po.id, po.outTradeNo, po.hiringIntentId, po.status, po.currency,
            po.grossAmountFen, po.platformFeeFen, po.developerPayableFen, po.developerUserId,
            hi.idempotencyFingerprint, a.name AS agentName
     FROM ai_direct_hiring_intents hi
     JOIN ai_direct_payment_orders po ON po.hiringIntentId = hi.id
     JOIN ai_direct_agents a ON a.id = hi.agentId
     WHERE hi.requestedByUserId = ? AND hi.idempotencyKey = ?
     LIMIT 1 FOR UPDATE`,
    [input.requestedByUserId, input.idempotencyKey],
  );
  return rows[0] ?? null;
}

function existingToOrder(row: ExistingOrderRow, fingerprint: string): PaidHiringOrder {
  if (row.idempotencyFingerprint !== fingerprint) {
    throw new AiDirectHiringError(
      ErrorCodes.IDEMPOTENCY_KEY_REUSED,
      "幂等键已用于不同的雇佣支付请求",
      409,
    );
  }
  if (row.status !== "pending") {
    throw new AiDirectHiringError(
      ErrorCodes.INVALID_TRANSITION,
      `该幂等请求对应的支付订单已处于 '${row.status}' 状态`,
      409,
    );
  }
  return {
    id: row.id,
    outTradeNo: row.outTradeNo,
    hiringIntentId: row.hiringIntentId,
    status: "pending",
    currency: "CNY",
    grossAmountFen: BigInt(row.grossAmountFen),
    platformFeeFen: BigInt(row.platformFeeFen),
    developerPayableFen: BigInt(row.developerPayableFen),
    developerUserId: row.developerUserId,
    agentName: row.agentName,
    replayed: true,
  };
}

async function loadHiringContext(
  connection: PoolConnection,
  input: CreatePaidHiringOrderInput,
): Promise<HiringContextRow> {
  const [rows] = await connection.query<HiringContextRow[]>(
    `SELECT c.organizationId, c.id AS companyId, r.projectId, r.id AS roleId,
            position.id AS positionId, a.id AS agentId, v.id AS agentVersionId, a.name AS agentName,
            a.ownerUserId AS developerUserId, price.id AS priceId,
            price.version AS priceVersion, price.currency, price.amountFen
     FROM ai_direct_companies c
     JOIN ai_direct_agent_roles r ON r.id = ? AND r.companyId = c.id AND r.status = 'open'
     JOIN ai_direct_position_agent_roles pr ON pr.roleId = r.id AND pr.positionId = ?
     JOIN ai_direct_positions position ON position.id = pr.positionId
       AND position.status = 'open' AND position.headcountFilled < position.headcountTarget
     JOIN ai_direct_departments department ON department.id = position.departmentId
       AND department.companyId = c.id AND department.status = 'active'
     JOIN ai_direct_agents a ON a.id = ? AND a.status = 'active'
       AND a.availability = 'available' AND a.catalogVisibility = 'org_authenticated'
     JOIN ai_direct_agent_versions v ON v.id = a.activeVersionId
       AND v.agentId = a.id AND v.status = 'published'
     JOIN ai_direct_agent_prices price ON price.agentId = a.id
       AND price.agentVersionId = v.id AND price.status = 'active'
       AND price.developerUserId = a.ownerUserId
     WHERE c.id = ? AND c.status = 'active'
       AND (? IS NULL OR (r.projectId = ? AND EXISTS (
         SELECT 1 FROM ai_direct_projects project
         WHERE project.id = ? AND project.companyId = c.id AND project.status = 'active'
       )))
     ORDER BY price.version DESC
     LIMIT 1 FOR SHARE`,
    [
      input.roleId,
      input.positionId,
      input.agentId,
      input.companyId,
      input.projectId,
      input.projectId,
      input.projectId,
    ],
  );
  const context = rows[0];
  if (!context) {
    throw new AiDirectHiringError(
      ErrorCodes.INVALID_TRANSITION,
      "Agent、已发布版本、开发者定价、Role、Project 或 Position 当前不可用于雇佣",
      409,
    );
  }
  if (input.projectId !== null && context.projectId !== input.projectId) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "Role 与 projectId 不匹配");
  }
  if (context.currency !== "CNY") {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "首期雇佣支付仅支持 CNY");
  }
  return context;
}

export async function createPaidHiringOrder(
  pool: Pick<Pool, "getConnection">,
  input: CreatePaidHiringOrderInput,
): Promise<PaidHiringOrder> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const existing = await findExistingOrder(connection, input);
    if (existing) {
      const result = existingToOrder(existing, input.idempotencyFingerprint);
      await connection.commit();
      return result;
    }

    const context = await loadHiringContext(connection, input);
    const split = splitPaidHiringAmount(BigInt(context.amountFen));
    const hiringIntentId = randomUUID();
    const paymentOrderId = randomUUID();
    const outTradeNo = newOutTradeNo();

    await connection.query(
      `INSERT INTO ai_direct_hiring_intents
       (id, organizationId, companyId, projectId, roleId, positionId, agentId, agentVersionId, priceId,
        requestedByUserId, status, idempotencyKey, idempotencyFingerprint)
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
    await connection.query(
      `INSERT INTO ai_direct_payment_orders
       (id, outTradeNo, hiringIntentId, provider, currency, grossAmountFen, platformFeeFen,
        developerPayableFen, developerUserId, priceId, priceVersion, status)
       VALUES (?, ?, ?, 'alipay', 'CNY', ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        paymentOrderId,
        outTradeNo,
        hiringIntentId,
        split.grossAmountFen,
        split.platformFeeFen,
        split.developerPayableFen,
        context.developerUserId,
        context.priceId,
        context.priceVersion,
      ],
    );
    await connection.query(
      `INSERT INTO ai_direct_audit_events
       (id, organizationId, actorUserId, action, targetType, targetId, requestId, outcome, metadata)
       VALUES (?, ?, ?, 'paid_hiring.order.created', 'payment_order', ?, ?, 'success', ?)`,
      [
        randomUUID(),
        context.organizationId,
        input.requestedByUserId,
        paymentOrderId,
        input.requestId,
        JSON.stringify({
          hiringIntentId,
          agentId: context.agentId,
          agentVersionId: context.agentVersionId,
          priceId: context.priceId,
          priceVersion: context.priceVersion,
          grossAmountFen: String(split.grossAmountFen),
        }),
      ],
    );
    await publishOutboxEvent(connection, {
      organizationId: context.organizationId,
      aggregateType: "payment_order",
      aggregateId: paymentOrderId,
      eventType: "paid_hiring.order.created.v1",
      payload: {
        paymentOrderId,
        hiringIntentId,
        outTradeNo,
        companyId: context.companyId,
        agentId: context.agentId,
        grossAmountFen: String(split.grossAmountFen),
        currency: "CNY",
      },
    });
    await connection.commit();
    return {
      id: paymentOrderId,
      outTradeNo,
      hiringIntentId,
      status: "pending",
      currency: "CNY",
      ...split,
      developerUserId: context.developerUserId,
      agentName: context.agentName,
      replayed: false,
    };
  } catch (error) {
    await connection.rollback();
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
      const existing = await findExistingOrder(connection, input);
      if (existing) return existingToOrder(existing, input.idempotencyFingerprint);
    }
    throw error;
  } finally {
    connection.release();
  }
}

export async function setActiveAgentPrice(
  pool: Pick<Pool, "getConnection">,
  input: { agentId: string; agentVersionId: string; developerUserId: string; amountFen: bigint },
): Promise<{ id: string; version: number; currency: "CNY"; amountFen: bigint }> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [agentRows] = await connection.query<RowDataPacket[]>(
      `SELECT a.ownerUserId, v.status AS versionStatus
       FROM ai_direct_agents a
       JOIN ai_direct_agent_versions v ON v.id = ? AND v.agentId = a.id
       WHERE a.id = ? LIMIT 1 FOR UPDATE`,
      [input.agentVersionId, input.agentId],
    );
    const agent = agentRows[0];
    if (!agent || agent.ownerUserId !== input.developerUserId) {
      throw new AiDirectHiringError(
        ErrorCodes.FORBIDDEN_SCOPE,
        "只有 Agent 开发者可以设置雇佣价格",
        403,
      );
    }
    if (agent.versionStatus !== "published") {
      throw new AiDirectHiringError(
        ErrorCodes.INVALID_TRANSITION,
        "只能为已发布 Agent 版本设置雇佣价格",
        409,
      );
    }
    const [versionRows] = await connection.query<RowDataPacket[]>(
      "SELECT COALESCE(MAX(version), 0) AS version FROM ai_direct_agent_prices WHERE agentId = ? FOR UPDATE",
      [input.agentId],
    );
    const version = Number(versionRows[0]?.version ?? 0) + 1;
    const priceId = randomUUID();
    await connection.query(
      `UPDATE ai_direct_agent_prices
       SET status = 'superseded', supersededAt = NOW(3)
       WHERE agentId = ? AND status = 'active'`,
      [input.agentId],
    );
    await connection.query(
      `INSERT INTO ai_direct_agent_prices
       (id, agentId, agentVersionId, developerUserId, version, currency, amountFen, status, createdByUserId)
       VALUES (?, ?, ?, ?, ?, 'CNY', ?, 'active', ?)`,
      [
        priceId,
        input.agentId,
        input.agentVersionId,
        input.developerUserId,
        version,
        input.amountFen,
        input.developerUserId,
      ],
    );
    await connection.commit();
    return { id: priceId, version, currency: "CNY", amountFen: input.amountFen };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
