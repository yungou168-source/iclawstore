import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/aiDirectAuth.js";
import { requireOrganizationRole } from "../middleware/aiDirectRbac.js";
import { AiDirectHiringError, ErrorCodes } from "../services/aiDirectErrors.js";

const PAGE_SIZE = 50;

const readOrganizationId = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 36) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "organizationId 必须是有效字符串");
  }
  return value.trim();
};

const readOptionalDate = (value: unknown, field: string, fallback: Date): Date => {
  if (value === undefined) return fallback;
  if (typeof value !== "string") {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 必须是 ISO 时间字符串`);
  }
  const result = new Date(value);
  if (!Number.isFinite(result.valueOf())) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 必须是有效时间`);
  }
  return result;
};

const encodeCursor = (row: { createdAt: Date; id: string }) =>
  Buffer.from(
    JSON.stringify({ createdAt: new Date(row.createdAt).toISOString(), id: row.id }),
  ).toString("base64url");

const decodeCursor = (value: unknown): { createdAt: Date; id: string } | null => {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length > 512) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "cursor 无效");
  }
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const createdAt = new Date(decoded.createdAt);
    if (typeof decoded.id !== "string" || !Number.isFinite(createdAt.valueOf()))
      throw new Error("invalid");
    return { createdAt, id: decoded.id };
  } catch {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "cursor 无效");
  }
};

const count = (row: unknown, key: string) =>
  Number((row as Record<string, unknown> | undefined)?.[key] ?? 0);
const micros = (value: unknown) => String(value ?? 0);

export async function aiDirectManagementInsightsRoutes(fastify: FastifyInstance): Promise<void> {
  const pool = (fastify as any).mysql as any;
  const auth = [(fastify as any).authenticate];

  const authorize = async (request: any) => {
    const user = await requireAuth(fastify, request);
    const organizationId = readOrganizationId(request.query?.organizationId);
    await requireOrganizationRole(pool, organizationId, user.id, "manager");
    return organizationId;
  };

  fastify.get("/management/overview", { onRequest: auth }, async (request: any) => {
    const organizationId = await authorize(request);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000);
    const [employmentRows, runRows, costRows, approvalRows] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS activeEmployees
         FROM ai_direct_employments e
         JOIN ai_direct_companies c ON c.id = e.companyId
         WHERE c.organizationId = ? AND e.status = 'active'`,
        [organizationId],
      ),
      pool.query(
        `SELECT SUM(status = 'queued') AS queuedRuns, SUM(status = 'active') AS activeRuns,
                SUM(status = 'failed') AS failedRuns
         FROM ai_direct_workflow_runs WHERE organizationId = ?`,
        [organizationId],
      ),
      pool.query(
        `SELECT COALESCE(SUM(costMicros), 0) AS costMicros,
                COALESCE(SUM(inputTokens), 0) AS inputTokens,
                COALESCE(SUM(outputTokens), 0) AS outputTokens
         FROM ai_direct_model_run_audits a
         JOIN ai_direct_workflow_runs r ON r.id = a.runId
         WHERE r.organizationId = ? AND a.createdAt >= ?`,
        [organizationId, since],
      ),
      pool.query(
        `SELECT COUNT(*) AS pendingApprovals
         FROM ai_direct_approvals WHERE organizationId = ? AND status = 'pending'`,
        [organizationId],
      ),
    ]);
    const employees = employmentRows[0][0];
    const runs = runRows[0][0];
    const costs = costRows[0][0];
    const approvals = approvalRows[0][0];
    return {
      window: { from: since.toISOString(), to: new Date().toISOString() },
      employees: { active: count(employees, "activeEmployees") },
      runs: {
        queued: count(runs, "queuedRuns"),
        active: count(runs, "activeRuns"),
        failed: count(runs, "failedRuns"),
      },
      costs: {
        currency: "USD",
        micros: micros(costs?.costMicros),
        inputTokens: count(costs, "inputTokens"),
        outputTokens: count(costs, "outputTokens"),
      },
      approvals: { pending: count(approvals, "pendingApprovals") },
    };
  });

  fastify.get("/management/system-status", { onRequest: auth }, async (request: any) => {
    const organizationId = await authorize(request);
    const [runRows, workerRows, outboxRows] = await Promise.all([
      pool.query(
        `SELECT SUM(status = 'queued') AS queued, SUM(status = 'active') AS active,
                SUM(status = 'failed') AS failed, SUM(status = 'active' AND leaseExpiresAt <= NOW(3)) AS expired
         FROM ai_direct_workflow_runs WHERE organizationId = ?`,
        [organizationId],
      ),
      pool.query(
        `SELECT leaseOwner AS workerId, MAX(lastHeartbeatAt) AS lastHeartbeatAt, COUNT(*) AS activeRuns
         FROM ai_direct_workflow_runs
         WHERE organizationId = ? AND status = 'active' AND leaseOwner IS NOT NULL
         GROUP BY leaseOwner ORDER BY lastHeartbeatAt DESC LIMIT 50`,
        [organizationId],
      ),
      pool.query(
        `SELECT MIN(occurredAt) AS oldestPendingAt, COUNT(*) AS pending
         FROM ai_direct_outbox_events WHERE organizationId = ? AND status = 'pending'`,
        [organizationId],
      ),
    ]);
    const runs = runRows[0][0];
    const outbox = outboxRows[0][0];
    return {
      generatedAt: new Date().toISOString(),
      runs: {
        queued: count(runs, "queued"),
        active: count(runs, "active"),
        failed: count(runs, "failed"),
        expired: count(runs, "expired"),
      },
      workers: workerRows[0],
      outbox: {
        pending: count(outbox, "pending"),
        oldestPendingAt: outbox?.oldestPendingAt ?? null,
      },
    };
  });

  fastify.get("/management/employees", { onRequest: auth }, async (request: any) => {
    const organizationId = await authorize(request);
    const status = typeof request.query?.status === "string" ? request.query.status : "active";
    if (!["active", "candidate", "suspended", "terminated", "transferring"].includes(status)) {
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "status 无效");
    }
    const cursor = decodeCursor(request.query?.cursor);
    const params: unknown[] = [organizationId, status];
    const after = cursor ? " AND (e.createdAt < ? OR (e.createdAt = ? AND e.id < ?))" : "";
    if (cursor) params.push(cursor.createdAt, cursor.createdAt, cursor.id);
    params.push(PAGE_SIZE + 1);
    const [rows] = await pool.query(
      `SELECT e.id, e.status, e.startedAt, e.endedAt, e.createdAt,
              a.id AS agentId, a.name AS agentName, c.id AS companyId, c.name AS companyName,
              r.id AS roleId, r.name AS roleName
       FROM ai_direct_employments e
       JOIN ai_direct_companies c ON c.id = e.companyId
       JOIN ai_direct_agents a ON a.id = e.agentId
       JOIN ai_direct_agent_roles r ON r.id = e.roleId
       WHERE c.organizationId = ? AND e.status = ?${after}
       ORDER BY e.createdAt DESC, e.id DESC LIMIT ?`,
      params,
    );
    const items = rows.slice(0, PAGE_SIZE);
    const last = items.at(-1);
    return { items, nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor(last) : null };
  });

  fastify.get("/management/cost-ledger", { onRequest: auth }, async (request: any) => {
    const organizationId = await authorize(request);
    const now = new Date();
    const from = readOptionalDate(
      request.query?.from,
      "from",
      new Date(now.valueOf() - 30 * 24 * 60 * 60 * 1_000),
    );
    const to = readOptionalDate(request.query?.to, "to", now);
    if (to <= from || to.valueOf() - from.valueOf() > 31 * 24 * 60 * 60 * 1_000) {
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "时间范围必须在 31 天内");
    }
    const cursor = decodeCursor(request.query?.cursor);
    const params: unknown[] = [organizationId, from, to];
    const after = cursor ? " AND (a.createdAt < ? OR (a.createdAt = ? AND a.id < ?))" : "";
    if (cursor) params.push(cursor.createdAt, cursor.createdAt, cursor.id);
    params.push(PAGE_SIZE + 1);
    const [rows] = await pool.query(
      `SELECT a.id, a.runId, a.agentId, a.agentVersionId, a.modelKey, a.providerKey, a.status,
              a.inputTokens, a.outputTokens, a.costMicros, a.latencyMs, a.createdAt
       FROM ai_direct_model_run_audits a
       JOIN ai_direct_workflow_runs r ON r.id = a.runId
       WHERE r.organizationId = ? AND a.createdAt >= ? AND a.createdAt < ?${after}
       ORDER BY a.createdAt DESC, a.id DESC LIMIT ?`,
      params,
    );
    const items = rows.slice(0, PAGE_SIZE).map((row: Record<string, unknown>) => ({
      ...row,
      costMicros: micros(row.costMicros),
    }));
    const last = items.at(-1) as { createdAt: Date; id: string } | undefined;
    return {
      window: { from: from.toISOString(), to: to.toISOString() },
      items,
      nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor(last) : null,
    };
  });
}
