import { randomUUID } from "node:crypto";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { publishOutboxEvent } from "../utils/outbox.js";
import { AiDirectHiringError, ErrorCodes } from "./aiDirectErrors.js";

export type AgentPrice = {
  id: string;
  agentId: string;
  agentVersionId: string;
  version: number;
  currency: "CNY";
  amountFen: bigint;
  status: "active" | "superseded";
  effectiveAt: Date;
  supersededAt: Date | null;
};

const toPrice = (row: RowDataPacket): AgentPrice => ({
  id: row.id,
  agentId: row.agentId,
  agentVersionId: row.agentVersionId,
  version: Number(row.version),
  currency: "CNY",
  amountFen: BigInt(row.amountFen),
  status: row.status === "active" ? "active" : "superseded",
  effectiveAt: row.effectiveAt,
  supersededAt: row.supersededAt,
});

export async function listAgentPrices(
  pool: Pick<Pool, "query">,
  agentId: string,
  developerUserId: string,
): Promise<AgentPrice[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.id, p.agentId, p.agentVersionId, p.version, p.currency, p.amountFen, p.status,
            p.effectiveAt, p.supersededAt
     FROM ai_direct_agent_prices p
     JOIN ai_direct_agents a ON a.id = p.agentId
     WHERE p.agentId = ? AND a.ownerUserId = ?
     ORDER BY p.version DESC`,
    [agentId, developerUserId],
  );
  return rows.map(toPrice);
}

export async function setAgentPrice(
  pool: Pick<Pool, "getConnection">,
  input: {
    agentId: string;
    agentVersionId: string;
    developerUserId: string;
    amountFen: bigint;
    requestId: string;
  },
): Promise<AgentPrice> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [agentRows] = await connection.query<RowDataPacket[]>(
      `SELECT a.ownerUserId, v.status AS versionStatus
       FROM ai_direct_agents a JOIN ai_direct_agent_versions v ON v.id = ? AND v.agentId = a.id
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
    const price: AgentPrice = {
      id: randomUUID(),
      agentId: input.agentId,
      agentVersionId: input.agentVersionId,
      version: Number(versionRows[0]?.version ?? 0) + 1,
      currency: "CNY",
      amountFen: input.amountFen,
      status: "active",
      effectiveAt: new Date(),
      supersededAt: null,
    };
    await connection.query(
      "UPDATE ai_direct_agent_prices SET status = 'superseded', supersededAt = NOW(3) WHERE agentId = ? AND status = 'active'",
      [input.agentId],
    );
    await connection.query(
      `INSERT INTO ai_direct_agent_prices
       (id, agentId, agentVersionId, developerUserId, version, currency, amountFen, status, createdByUserId)
       VALUES (?, ?, ?, ?, ?, 'CNY', ?, 'active', ?)`,
      [
        price.id,
        price.agentId,
        price.agentVersionId,
        input.developerUserId,
        price.version,
        price.amountFen,
        input.developerUserId,
      ],
    );
    await connection.query(
      `INSERT INTO ai_direct_audit_events
       (id, actorUserId, action, targetType, targetId, requestId, outcome, metadata)
       VALUES (?, ?, 'paid_hiring.price.set', 'agent_price', ?, ?, 'success', ?)`,
      [
        randomUUID(),
        input.developerUserId,
        price.id,
        input.requestId,
        JSON.stringify({
          agentId: price.agentId,
          version: price.version,
          amountFen: String(price.amountFen),
        }),
      ],
    );
    await publishOutboxEvent(connection, {
      organizationId: null,
      aggregateType: "agent_price",
      aggregateId: price.id,
      eventType: "paid_hiring.price.set.v1",
      payload: {
        agentId: price.agentId,
        agentVersionId: price.agentVersionId,
        version: price.version,
        amountFen: String(price.amountFen),
        currency: "CNY",
      },
    });
    await connection.commit();
    return price;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export const withLockedConnection = async <T>(
  connection: PoolConnection,
  fn: () => Promise<T>,
): Promise<T> => fn();
