import type { Pool } from "mysql2/promise";
import {
  auditProjectionSourceSql,
  completeAuditExportJob,
  failAuditExportJob,
  leaseAuditExportJob,
  projectAuditRow,
  type RawAuditProjectionRow,
} from "./auditProjection.js";

const EXPORT_ROW_LIMIT = 10_000;
const EXPORT_BYTE_LIMIT = 16 * 1024 * 1024;

type ExportFilters = {
  organizationId: string;
  from: Date;
  to: Date;
  actorUserId?: string;
  resourceType?: string;
  resourceId?: string;
  action?: string;
  requestId?: string;
};

export type AuditExportRunResult =
  | { kind: "idle" }
  | { kind: "completed"; jobId: string; rowCount: number; byteCount: number }
  | { kind: "failed"; jobId: string; failureCode: string };

export async function runNextAuditExport(
  pool: Pool,
  workerId: string,
): Promise<AuditExportRunResult> {
  const job = await leaseAuditExportJob(pool, workerId);
  if (!job) return { kind: "idle" };

  try {
    const filters = parseFilters(job.filters, job.organizationId);
    const rows = await readRows(pool, filters);
    if (rows.length > EXPORT_ROW_LIMIT) {
      await failAuditExportJob(pool, {
        jobId: job.id,
        workerId,
        failureCode: "AUDIT_EXPORT_ROW_LIMIT",
      });
      return { kind: "failed", jobId: job.id, failureCode: "AUDIT_EXPORT_ROW_LIMIT" };
    }

    const content = renderCsv(rows, job.watermark);
    if (content.byteLength > EXPORT_BYTE_LIMIT) {
      await failAuditExportJob(pool, {
        jobId: job.id,
        workerId,
        failureCode: "AUDIT_EXPORT_SIZE_LIMIT",
      });
      return { kind: "failed", jobId: job.id, failureCode: "AUDIT_EXPORT_SIZE_LIMIT" };
    }

    const completed = await completeAuditExportJob(pool, {
      jobId: job.id,
      workerId,
      content,
      mimeType: "text/csv; charset=utf-8",
      fileName: `audit-${job.organizationId}-${job.id}.csv`,
    });
    if (!completed)
      return { kind: "failed", jobId: job.id, failureCode: "AUDIT_EXPORT_LEASE_LOST" };
    return {
      kind: "completed",
      jobId: job.id,
      rowCount: rows.length,
      byteCount: content.byteLength,
    };
  } catch (error) {
    const failureCode = error instanceof AuditExportInputError ? error.code : "AUDIT_EXPORT_FAILED";
    await failAuditExportJob(pool, { jobId: job.id, workerId, failureCode }).catch(() => false);
    return { kind: "failed", jobId: job.id, failureCode };
  }
}

class AuditExportInputError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function parseFilters(value: Record<string, unknown>, organizationId: string): ExportFilters {
  const from = new Date(String(value.from ?? ""));
  const to = new Date(String(value.to ?? ""));
  if (!Number.isFinite(from.valueOf()) || !Number.isFinite(to.valueOf()) || from >= to) {
    throw new AuditExportInputError("AUDIT_EXPORT_FILTERS_INVALID");
  }
  const optional = (key: string) => {
    const field = value[key];
    return typeof field === "string" && field.length > 0 ? field : undefined;
  };
  return {
    organizationId,
    from,
    to,
    actorUserId: optional("actorUserId"),
    resourceType: optional("resourceType"),
    resourceId: optional("resourceId"),
    action: optional("action"),
    requestId: optional("requestId"),
  };
}

async function readRows(pool: Pool, filters: ExportFilters): Promise<RawAuditProjectionRow[]> {
  const values: unknown[] = [
    filters.organizationId,
    filters.from,
    filters.to,
    filters.organizationId,
    filters.from,
    filters.to,
    filters.organizationId,
    filters.from,
    filters.to,
  ];
  const where: string[] = [];
  for (const [column, value] of [
    ["actorUserId", filters.actorUserId],
    ["resourceType", filters.resourceType],
    ["resourceId", filters.resourceId],
    ["action", filters.action],
    ["requestId", filters.requestId],
  ] as const) {
    if (value) {
      where.push(`${column} = ?`);
      values.push(value);
    }
  }
  values.push(EXPORT_ROW_LIMIT + 1);
  const [rows] = await pool.query(
    `SELECT source, id, organizationId, actorUserId, action, resourceType, resourceId,
            requestId, outcome, metadata, createdAt
     FROM (${auditProjectionSourceSql()}) audit_projection
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY createdAt DESC, source ASC, id DESC
     LIMIT ?`,
    values,
  );
  return rows as RawAuditProjectionRow[];
}

function renderCsv(rows: RawAuditProjectionRow[], watermark: string): Uint8Array {
  const header = [
    "watermark",
    "createdAt",
    "source",
    "eventId",
    "organizationId",
    "actorUserId",
    "action",
    "resourceType",
    "resourceId",
    "requestId",
    "outcome",
    "metadata",
  ];
  const lines = [header.map(csvCell).join(",")];
  if (rows.length === 0)
    lines.push([watermark, "", "", "", "", "", "", "", "", "", "", ""].map(csvCell).join(","));
  for (const raw of rows) {
    const row = projectAuditRow(raw);
    lines.push(
      [
        watermark,
        row.createdAt,
        row.source,
        row.id,
        row.organizationId,
        row.actorUserId ?? "",
        row.action,
        row.resourceType,
        row.resourceId,
        row.requestId ?? "",
        row.outcome,
        row.metadata ? JSON.stringify(row.metadata) : "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return Buffer.from(`\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
}

function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
