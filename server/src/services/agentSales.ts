import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { publishOutboxEvent } from "../utils/outbox.js";
import { AiDirectHiringError, ErrorCodes } from "./aiDirectErrors.js";
import { synchronizeWorkforceEmployeeDigest } from "./workforceEmployeeDigestSync.js";

export type AgentSaleContext = {
  hiringIntentId: string;
  paymentOrderId: string | null;
  organizationId: string;
  companyId: string;
  projectId: string | null;
  roleId: string;
  positionId: string;
  agentId: string;
  agentVersionId: string;
  requestedByUserId: string;
  developerUserId: string;
  priceId: string;
  priceVersion: number;
  pricingMode: "free" | "paid";
  grossAmountFen: bigint;
  platformRevenueFen: bigint;
  developerRevenueFen: bigint;
};

export type AgentSaleResult = {
  saleId: string;
  saleNo: string;
  offerId: string;
  employmentId: string;
};

export type AgentSale = {
  id: string;
  saleNo: string;
  paymentOrderId: string | null;
  employmentId: string;
  offerId: string;
  companyId: string;
  companyName: string;
  roleId: string;
  roleName: string;
  agentId: string;
  agentName: string;
  agentVersionId: string;
  priceVersion: number;
  pricingMode: "free" | "paid";
  currency: "CNY";
  grossAmountFen: bigint;
  platformRevenueFen: bigint;
  developerRevenueFen: bigint;
  refundedFen: bigint;
  status: string;
  completedAt: Date;
};

const newSaleNo = (): string =>
  `SALE${new Date().toISOString().replace(/\D/g, "").slice(0, 17)}${randomBytes(8).toString("hex").toUpperCase()}`;

export async function completeAgentSale(
  connection: PoolConnection,
  context: AgentSaleContext,
): Promise<AgentSaleResult> {
  const [existingRows] = await connection.query<RowDataPacket[]>(
    `SELECT id, saleNo, offerId, employmentId
     FROM ai_direct_agent_sales WHERE hiringIntentId = ? LIMIT 1 FOR UPDATE`,
    [context.hiringIntentId],
  );
  if (existingRows[0]) {
    return {
      saleId: existingRows[0].id,
      saleNo: existingRows[0].saleNo,
      offerId: existingRows[0].offerId,
      employmentId: existingRows[0].employmentId,
    };
  }

  const [positionRows] = await connection.query<RowDataPacket[]>(
    `SELECT p.id, p.status
     FROM ai_direct_positions p
     JOIN ai_direct_departments d ON d.id = p.departmentId
     JOIN ai_direct_position_agent_roles pr ON pr.positionId = p.id AND pr.roleId = ?
     WHERE p.id = ? AND d.companyId = ? AND d.status = 'active'
     LIMIT 1 FOR UPDATE`,
    [context.roleId, context.positionId, context.companyId],
  );
  if (!positionRows[0] || positionRows[0].status !== "open") {
    throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, "对应 Position 已不可雇佣", 409);
  }
  const [headcount] = await connection.query<ResultSetHeader>(
    `UPDATE ai_direct_positions
     SET headcountFilled = headcountFilled + 1, updatedAt = NOW(3)
     WHERE id = ? AND headcountFilled < headcountTarget`,
    [context.positionId],
  );
  if (headcount.affectedRows !== 1) {
    throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, "Position 编制已满", 409);
  }

  await connection.query("SELECT id FROM ai_direct_agents WHERE id = ? LIMIT 1 FOR UPDATE", [
    context.agentId,
  ]);
  const [profileRows] = await connection.query<RowDataPacket[]>(
    `SELECT controllerEmploymentId FROM ai_direct_agent_appearance_profiles
     WHERE agentId = ? LIMIT 1 FOR UPDATE`,
    [context.agentId],
  );
  if (profileRows[0]?.controllerEmploymentId) {
    throw new AiDirectHiringError(
      ErrorCodes.APPEARANCE_CONTROL_CONFLICT,
      "该 Agent 已被另一家公司雇佣",
      409,
    );
  }

  const saleId = randomUUID();
  const saleNo = newSaleNo();
  const offerId = randomUUID();
  const employmentId = randomUUID();
  await connection.query(
    `INSERT INTO ai_direct_offers
     (id, roleId, agentVersionId, companyId, projectId, status, terms, proposedByUserId,
      proposedAt, paymentOrderId, issuedAt)
     VALUES (?, ?, ?, ?, ?, 'issued', ?, ?, NOW(3), ?, NOW(3))`,
    [
      offerId,
      context.roleId,
      context.agentVersionId,
      context.companyId,
      context.projectId,
      JSON.stringify({
        pricingMode: context.pricingMode,
        currency: "CNY",
        grossAmountFen: String(context.grossAmountFen),
        platformFeeFen: String(context.platformRevenueFen),
        developerPayableFen: String(context.developerRevenueFen),
        priceId: context.priceId,
        priceVersion: context.priceVersion,
      }),
      context.requestedByUserId,
      context.paymentOrderId,
    ],
  );
  await connection.query(
    `INSERT INTO ai_direct_employments
     (id, companyId, agentId, agentVersionId, roleId, projectId, offerId, paymentOrderId,
      requestedByUserId, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'onboarding')`,
    [
      employmentId,
      context.companyId,
      context.agentId,
      context.agentVersionId,
      context.roleId,
      context.projectId,
      offerId,
      context.paymentOrderId,
      context.requestedByUserId,
    ],
  );
  await connection.query(
    `INSERT INTO ai_direct_agent_sales
     (id, saleNo, hiringIntentId, employmentId, offerId, paymentOrderId, organizationId,
      companyId, projectId, roleId, positionId, buyerUserId, developerUserId, agentId,
      agentVersionId, priceId, priceVersion, pricingMode, currency, grossAmountFen,
      platformRevenueFen, developerRevenueFen, status, completedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CNY', ?, ?, ?, 'completed', NOW(3))`,
    [
      saleId,
      saleNo,
      context.hiringIntentId,
      employmentId,
      offerId,
      context.paymentOrderId,
      context.organizationId,
      context.companyId,
      context.projectId,
      context.roleId,
      context.positionId,
      context.requestedByUserId,
      context.developerUserId,
      context.agentId,
      context.agentVersionId,
      context.priceId,
      context.priceVersion,
      context.pricingMode,
      context.grossAmountFen,
      context.platformRevenueFen,
      context.developerRevenueFen,
    ],
  );
  await connection.query(
    `INSERT INTO ai_direct_revenue_ledger_entries
     (id, entryKey, saleId, paymentOrderId, accountType, accountOwnerUserId, direction,
      currency, amountFen, metadata)
     VALUES (?, ?, ?, ?, 'platform_revenue', NULL, 'credit', 'CNY', ?, ?),
            (?, ?, ?, ?, 'developer_payable', ?, 'credit', 'CNY', ?, ?)`,
    [
      randomUUID(),
      `${saleId}:platform_revenue`,
      saleId,
      context.paymentOrderId,
      context.platformRevenueFen,
      JSON.stringify({
        pricingMode: context.pricingMode,
        percentage: context.pricingMode === "paid" ? 20 : 0,
      }),
      randomUUID(),
      `${saleId}:developer_payable:${context.developerUserId}`,
      saleId,
      context.paymentOrderId,
      context.developerUserId,
      context.developerRevenueFen,
      JSON.stringify({
        pricingMode: context.pricingMode,
        percentage: context.pricingMode === "paid" ? 80 : 0,
      }),
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
    [context.agentId, employmentId, context.companyId, context.requestedByUserId],
  );
  await connection.query(
    `INSERT INTO ai_direct_employment_events
     (id, employmentId, sequence, fromStatus, toStatus, actorUserId, reason, metadata)
     VALUES (?, ?, 1, NULL, 'onboarding', ?, 'Employment created from completed Agent sale', ?)`,
    [
      randomUUID(),
      employmentId,
      context.requestedByUserId,
      JSON.stringify({ saleId, paymentOrderId: context.paymentOrderId, offerId }),
    ],
  );
  await synchronizeWorkforceEmployeeDigest(connection, employmentId);
  await connection.query(
    `INSERT INTO ai_direct_organization_candidate_catalog_counts (organizationId, agentId, isEmployed)
     VALUES (?, ?, TRUE)
     ON DUPLICATE KEY UPDATE isEmployed = TRUE`,
    [context.organizationId, context.agentId],
  );
  await publishOutboxEvent(connection, {
    organizationId: context.organizationId,
    aggregateType: "agent_sale",
    aggregateId: saleId,
    eventType: "agent_sale.completed.v1",
    payload: {
      saleId,
      saleNo,
      pricingMode: context.pricingMode,
      employmentId,
      offerId,
      paymentOrderId: context.paymentOrderId,
      companyId: context.companyId,
      agentId: context.agentId,
      developerUserId: context.developerUserId,
      grossAmountFen: String(context.grossAmountFen),
      platformRevenueFen: String(context.platformRevenueFen),
      developerRevenueFen: String(context.developerRevenueFen),
    },
  });
  return { saleId, saleNo, offerId, employmentId };
}

export async function listDeveloperAgentSales(
  pool: Pick<Pool, "query">,
  input: { developerUserId: string; limit?: number },
): Promise<AgentSale[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT sale.id, sale.saleNo, sale.paymentOrderId, sale.employmentId, sale.offerId,
            sale.companyId, company.name AS companyName, sale.roleId, role.name AS roleName,
            sale.agentId, agent.name AS agentName, sale.agentVersionId, sale.priceVersion,
            sale.pricingMode, sale.currency, sale.grossAmountFen, sale.platformRevenueFen,
            sale.developerRevenueFen, sale.refundedFen, sale.status, sale.completedAt
     FROM ai_direct_agent_sales sale
     JOIN ai_direct_companies company ON company.id = sale.companyId
     JOIN ai_direct_agent_roles role ON role.id = sale.roleId
     JOIN ai_direct_agents agent ON agent.id = sale.agentId
     WHERE sale.developerUserId = ?
     ORDER BY sale.createdAt DESC, sale.id DESC LIMIT ?`,
    [input.developerUserId, limit],
  );
  return rows.map((row) => ({
    ...row,
    pricingMode: row.pricingMode === "free" ? "free" : "paid",
    currency: "CNY",
    priceVersion: Number(row.priceVersion),
    grossAmountFen: BigInt(row.grossAmountFen),
    platformRevenueFen: BigInt(row.platformRevenueFen),
    developerRevenueFen: BigInt(row.developerRevenueFen),
    refundedFen: BigInt(row.refundedFen),
  })) as AgentSale[];
}
