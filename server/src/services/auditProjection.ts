import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "mysql2/promise";

export type AuditSource = "domain" | "model_run" | "template";

export type RawAuditProjectionRow = {
  source: AuditSource;
  id: string;
  organizationId: string;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  requestId: string | null;
  outcome: string;
  metadata: unknown;
  createdAt: Date | string;
};

export type SafeAuditEvent = Omit<RawAuditProjectionRow, "metadata" | "createdAt"> & {
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

const forbiddenField =
  /(?:api.?key|model.?key|provider.?key|secret|credential|authorization|prompt|(?:^|_)(?:full_)?input(?:_|$)|(?:^|_)(?:full_)?output(?:_|$)|storage.?path|internal.?retry|retry.?payload|raw.?request|raw.?response|message.?content)/i;
const MAX_DEPTH = 5;
const MAX_ARRAY_ITEMS = 50;
const MAX_TEXT_LENGTH = 2_000;

export function auditProjectionSourceSql(): string {
  return `
    SELECT 'domain' AS source, e.id, e.organizationId, e.actorUserId, e.action,
           e.targetType AS resourceType, e.targetId AS resourceId, e.requestId,
           e.outcome, e.metadata, e.createdAt
    FROM ai_direct_audit_events e
    WHERE e.organizationId = ? AND e.createdAt >= ? AND e.createdAt < ?
    UNION ALL
    SELECT 'model_run' AS source, m.id, r.organizationId,
           r.requestedByUserId AS actorUserId, CONCAT('model.run.', m.status) AS action,
           'workflow_run' AS resourceType, COALESCE(m.runId, m.id) AS resourceId,
           m.providerRequestId AS requestId, m.status AS outcome,
           JSON_OBJECT(
             'agentId', m.agentId, 'agentVersionId', m.agentVersionId,
             'catalogModelId', m.catalogModelId, 'taskType', m.taskType,
             'failureCode', m.failureCode, 'failureClass', m.failureClass,
             'inputTokens', m.inputTokens, 'outputTokens', m.outputTokens,
             'costMicros', CAST(m.costMicros AS CHAR), 'latencyMs', m.latencyMs
           ) AS metadata, m.createdAt
    FROM ai_direct_model_run_audits m
    JOIN ai_direct_workflow_runs r ON r.id = m.runId
    WHERE r.organizationId = ? AND m.createdAt >= ? AND m.createdAt < ?
    UNION ALL
    SELECT 'template' AS source, t.id, t.organizationId, t.actorUserId, t.action,
           t.targetType AS resourceType, t.targetId AS resourceId, t.requestId,
           t.outcome, t.metadata, t.createdAt
    FROM desktop_template_audit_events t
    WHERE t.organizationId = ? AND t.createdAt >= ? AND t.createdAt < ?`;
}

function safeValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return undefined;
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") {
    return value.length <= MAX_TEXT_LENGTH ? value : `${value.slice(0, MAX_TEXT_LENGTH)}…`;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => safeValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !forbiddenField.test(key))
      .map(([key, child]) => [key, safeValue(child, depth + 1)])
      .filter((entry): entry is [string, unknown] => entry[1] !== undefined),
  );
}

export function redactAuditMetadata(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return redactAuditMetadata(JSON.parse(value));
    } catch {
      return null;
    }
  }
  const redacted = safeValue(value, 0);
  return redacted && typeof redacted === "object" && !Array.isArray(redacted)
    ? (redacted as Record<string, unknown>)
    : null;
}

export function projectAuditRow(row: RawAuditProjectionRow): SafeAuditEvent {
  return {
    source: row.source,
    id: row.id,
    organizationId: row.organizationId,
    actorUserId: row.actorUserId,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    requestId: row.requestId,
    outcome: row.outcome,
    metadata: redactAuditMetadata(row.metadata),
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

export type ExportWorkerJob = {
  id: string;
  organizationId: string;
  requestedByUserId: string;
  filters: Record<string, unknown>;
  watermark: string;
  attemptCount: number;
};

export async function leaseAuditExportJob(
  pool: Pool,
  workerId: string,
  leaseSeconds = 120,
): Promise<ExportWorkerJob | null> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT id, organizationId, requestedByUserId, filters, watermark, attemptCount
       FROM ai_direct_audit_export_jobs
       WHERE (status = 'queued' OR (status = 'processing' AND leaseExpiresAt < NOW(3)))
       ORDER BY createdAt ASC, id ASC
       LIMIT 1 FOR UPDATE SKIP LOCKED`,
    );
    const row = (rows as Array<Record<string, unknown>>)[0];
    if (!row) {
      await connection.rollback();
      return null;
    }
    await connection.query(
      `UPDATE ai_direct_audit_export_jobs
       SET status = 'processing', leaseOwner = ?, leaseExpiresAt = DATE_ADD(NOW(3), INTERVAL ? SECOND),
           attemptCount = attemptCount + 1, startedAt = COALESCE(startedAt, NOW(3)), updatedAt = NOW(3)
       WHERE id = ?`,
      [workerId, leaseSeconds, row.id],
    );
    await connection.commit();
    return {
      id: String(row.id),
      organizationId: String(row.organizationId),
      requestedByUserId: String(row.requestedByUserId),
      filters: redactAuditMetadata(row.filters) ?? {},
      watermark: String(row.watermark),
      attemptCount: Number(row.attemptCount) + 1,
    };
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

export async function completeAuditExportJob(
  pool: Pool,
  input: {
    jobId: string;
    workerId: string;
    content: Uint8Array;
    mimeType: string;
    fileName: string;
  },
): Promise<boolean> {
  const digest = createHash("sha256").update(input.content).digest("hex");
  const [result] = await pool.query(
    `UPDATE ai_direct_audit_export_jobs
     SET status = 'completed', artifact = ?, artifactMimeType = ?, artifactFileName = ?, artifactSha256 = ?,
         artifactSizeBytes = ?, completedAt = NOW(3), leaseOwner = NULL, leaseExpiresAt = NULL, updatedAt = NOW(3)
     WHERE id = ? AND status = 'processing' AND leaseOwner = ?`,
    [
      Buffer.from(input.content),
      input.mimeType,
      input.fileName,
      digest,
      input.content.byteLength,
      input.jobId,
      input.workerId,
    ],
  );
  return Number((result as { affectedRows?: number }).affectedRows ?? 0) === 1;
}

export async function failAuditExportJob(
  pool: Pool,
  input: { jobId: string; workerId: string; failureCode: string },
): Promise<boolean> {
  const [result] = await pool.query(
    `UPDATE ai_direct_audit_export_jobs
     SET status = 'failed', failureCode = ?, completedAt = NOW(3), leaseOwner = NULL,
         leaseExpiresAt = NULL, updatedAt = NOW(3)
     WHERE id = ? AND status = 'processing' AND leaseOwner = ?`,
    [input.failureCode.slice(0, 128), input.jobId, input.workerId],
  );
  return Number((result as { affectedRows?: number }).affectedRows ?? 0) === 1;
}

export function createDownloadToken(): {
  id: string;
  token: string;
  tokenHash: string;
  tokenPrefix: string;
} {
  const token = `ada_${randomBytes(32).toString("base64url")}`;
  return {
    id: randomUUID(),
    token,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    tokenPrefix: token.slice(0, 12),
  };
}

export function hashDownloadToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
