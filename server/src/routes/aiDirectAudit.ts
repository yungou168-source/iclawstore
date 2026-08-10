import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool, PoolConnection } from "mysql2/promise";
import { requireAuth } from "../middleware/aiDirectAuth.js";
import { requireOrganizationRole } from "../middleware/aiDirectRbac.js";
import { AiDirectHiringError, ErrorCodes } from "../services/aiDirectErrors.js";
import {
  auditProjectionSourceSql,
  createDownloadToken,
  hashDownloadToken,
  projectAuditRow,
  type RawAuditProjectionRow,
} from "../services/auditProjection.js";

const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1_000;
const DOWNLOAD_TOKEN_TTL_SECONDS = 300;

type AuditFilters = {
  organizationId: string;
  from: Date;
  to: Date;
  actorUserId?: string;
  resourceType?: string;
  resourceId?: string;
  action?: string;
  requestId?: string;
};

type AuditCursor = { createdAt: string; source: string; id: string };

function validation(message: string): never {
  throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, message, 400);
}

function requiredText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum)
    validation(`${field} 无效`);
  return value.trim();
}

function optionalText(value: unknown, field: string, maximum: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredText(value, field, maximum);
}

function readInstant(value: unknown, field: string): Date {
  const text = requiredText(value, field, 64);
  const date = new Date(text);
  if (!Number.isFinite(date.valueOf())) validation(`${field} 必须是有效时间`);
  return date;
}

function filtersFrom(value: unknown): AuditFilters {
  const query = (value ?? {}) as Record<string, unknown>;
  const from = readInstant(query.from, "from");
  const to = readInstant(query.to, "to");
  if (from >= to) validation("from 必须早于 to");
  if (to.valueOf() - from.valueOf() > MAX_RANGE_MS) validation("时间范围不能超过 31 天");
  return {
    organizationId: requiredText(query.organizationId, "organizationId", 36),
    from,
    to,
    actorUserId: optionalText(query.actorUserId ?? query.actor, "actorUserId", 191),
    resourceType: optionalText(query.resourceType, "resourceType", 64),
    resourceId: optionalText(query.resourceId ?? query.resource, "resourceId", 191),
    action: optionalText(query.action, "action", 128),
    requestId: optionalText(query.requestId, "requestId", 128),
  };
}

function encodeCursor(value: AuditCursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(value: unknown): AuditCursor | null {
  if (value === undefined || value === null || value === "") return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(requiredText(value, "cursor", 1024), "base64url").toString("utf8"),
    ) as AuditCursor;
    if (
      !decoded ||
      typeof decoded.createdAt !== "string" ||
      typeof decoded.source !== "string" ||
      typeof decoded.id !== "string"
    ) {
      validation("cursor 无效");
    }
    if (!Number.isFinite(new Date(decoded.createdAt).valueOf())) validation("cursor 无效");
    return decoded;
  } catch (error) {
    if (error instanceof AiDirectHiringError) throw error;
    validation("cursor 无效");
  }
}

async function requireAuditPermission(
  pool: Pool,
  organizationId: string,
  userId: string,
  action: "audit:read" | "audit:export",
): Promise<void> {
  const [rows] = await pool.query(
    `SELECT 1 AS allowed
     FROM ai_direct_organization_members m
     WHERE m.organizationId = ? AND m.userId = ? AND m.status = 'active'
       AND (
         m.role IN ('owner', 'admin')
         OR EXISTS (
           SELECT 1 FROM ai_direct_capability_grants g
           WHERE g.subjectType = 'user' AND g.subjectId = ?
             AND g.resourceType = 'organization' AND g.resourceId = ? AND g.action = ?
             AND g.revokedAt IS NULL AND (g.expiresAt IS NULL OR g.expiresAt > NOW(3))
         )
       )
     LIMIT 1`,
    [organizationId, userId, userId, organizationId, action],
  );
  if (!(rows as unknown[])[0]) {
    throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, "没有该组织的审计权限", 403);
  }
}

async function inTransaction<T>(
  pool: Pool,
  operation: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

async function queryEvents(
  pool: Pool,
  filters: AuditFilters,
  cursor: AuditCursor | null,
  limit: number,
) {
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
  if (filters.actorUserId) {
    where.push("actorUserId = ?");
    values.push(filters.actorUserId);
  }
  if (filters.resourceType) {
    where.push("resourceType = ?");
    values.push(filters.resourceType);
  }
  if (filters.resourceId) {
    where.push("resourceId = ?");
    values.push(filters.resourceId);
  }
  if (filters.action) {
    where.push("action = ?");
    values.push(filters.action);
  }
  if (filters.requestId) {
    where.push("requestId = ?");
    values.push(filters.requestId);
  }
  if (cursor) {
    where.push(
      "(createdAt < ? OR (createdAt = ? AND source > ?) OR (createdAt = ? AND source = ? AND id < ?))",
    );
    const cursorTime = new Date(cursor.createdAt);
    values.push(cursorTime, cursorTime, cursor.source, cursorTime, cursor.source, cursor.id);
  }
  values.push(limit + 1);
  const [rows] = await pool.query(
    `SELECT source, id, organizationId, actorUserId, action, resourceType, resourceId,
            requestId, outcome, metadata, createdAt
     FROM (${auditProjectionSourceSql()}) audit_projection
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY createdAt DESC, source ASC, id DESC
     LIMIT ?`,
    values,
  );
  const typed = rows as RawAuditProjectionRow[];
  const page = typed.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(projectAuditRow),
    nextCursor:
      typed.length > limit && last
        ? encodeCursor({
            createdAt: new Date(last.createdAt).toISOString(),
            source: last.source,
            id: last.id,
          })
        : null,
  };
}

function requestIdFrom(headers: Record<string, unknown>): string {
  const value = headers["x-request-id"];
  return typeof value === "string" && value.length > 0 && value.length <= 128
    ? value
    : randomUUID();
}

export async function aiDirectAuditRoutes(fastify: FastifyInstance): Promise<void> {
  const pool = fastify.mysql as Pool;
  const auth = { onRequest: [fastify.authenticate] };

  fastify.post("/audit/grants", auth, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const organizationId = requiredText(body.organizationId, "organizationId", 36);
    const subjectUserId = requiredText(body.subjectUserId, "subjectUserId", 191);
    const action = requiredText(body.action, "action", 64);
    if (action !== "audit:read" && action !== "audit:export")
      validation("action 仅支持 audit:read 或 audit:export");
    await requireOrganizationRole(pool, organizationId, user.id, "admin");
    const expiresAt = body.expiresAt ? readInstant(body.expiresAt, "expiresAt") : null;
    if (expiresAt && expiresAt <= new Date()) validation("expiresAt 必须晚于当前时间");
    const grantRequestId = requestIdFrom(request.headers);
    return inTransaction(pool, async (connection) => {
      const [members] = await connection.query(
        `SELECT 1 FROM ai_direct_organization_members
         WHERE organizationId = ? AND userId = ? AND status = 'active' LIMIT 1 FOR UPDATE`,
        [organizationId, subjectUserId],
      );
      if (!(members as unknown[])[0]) {
        throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "授权对象不是该组织的有效成员", 404);
      }
      const [existing] = await connection.query(
        `SELECT id FROM ai_direct_capability_grants
         WHERE subjectType = 'user' AND subjectId = ? AND resourceType = 'organization'
           AND resourceId = ? AND action = ? AND revokedAt IS NULL
           AND (expiresAt IS NULL OR expiresAt > NOW(3)) LIMIT 1 FOR UPDATE`,
        [subjectUserId, organizationId, action],
      );
      const replay = (existing as Array<{ id: string }>)[0];
      if (replay) return reply.status(200).send({ id: replay.id, replayed: true });
      const grantId = randomUUID();
      await connection.query(
        `INSERT INTO ai_direct_capability_grants
         (id, subjectType, subjectId, resourceType, resourceId, action, scope, issuedByUserId, expiresAt)
         VALUES (?, 'user', ?, 'organization', ?, ?, CAST(? AS JSON), ?, ?)`,
        [
          grantId,
          subjectUserId,
          organizationId,
          action,
          JSON.stringify({ auditOnly: true }),
          user.id,
          expiresAt,
        ],
      );
      await connection.query(
        `INSERT INTO ai_direct_audit_events
         (id, organizationId, actorUserId, action, targetType, targetId, requestId, outcome, metadata)
         VALUES (?, ?, ?, 'audit.grant.issued', 'capability_grant', ?, ?, 'success', CAST(? AS JSON))`,
        [
          randomUUID(),
          organizationId,
          user.id,
          grantId,
          grantRequestId,
          JSON.stringify({ subjectUserId, grantedAction: action, expiresAt }),
        ],
      );
      return reply.status(201).send({ id: grantId, action, expiresAt });
    });
  });

  fastify.delete("/audit/grants/:id", auth, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const organizationId = requiredText(request.query?.organizationId, "organizationId", 36);
    await requireOrganizationRole(pool, organizationId, user.id, "admin");
    return inTransaction(pool, async (connection) => {
      const [rows] = await connection.query(
        `SELECT id, subjectId, action, revokedAt FROM ai_direct_capability_grants
         WHERE id = ? AND subjectType = 'user' AND resourceType = 'organization' AND resourceId = ?
           AND action IN ('audit:read', 'audit:export') LIMIT 1 FOR UPDATE`,
        [request.params.id, organizationId],
      );
      const grant = (
        rows as Array<{ id: string; subjectId: string; action: string; revokedAt: Date | null }>
      )[0];
      if (!grant) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "审计授权不存在", 404);
      if (grant.revokedAt)
        return reply.status(200).send({ id: grant.id, revoked: true, replayed: true });
      await connection.query(
        `UPDATE ai_direct_capability_grants
         SET revokedAt = NOW(3), revokedByUserId = ?, revokeReason = 'audit governance revoke'
         WHERE id = ? AND revokedAt IS NULL`,
        [user.id, grant.id],
      );
      await connection.query(
        `INSERT INTO ai_direct_audit_events
         (id, organizationId, actorUserId, action, targetType, targetId, requestId, outcome, metadata)
         VALUES (?, ?, ?, 'audit.grant.revoked', 'capability_grant', ?, ?, 'success', CAST(? AS JSON))`,
        [
          randomUUID(),
          organizationId,
          user.id,
          grant.id,
          requestIdFrom(request.headers),
          JSON.stringify({ subjectUserId: grant.subjectId, revokedAction: grant.action }),
        ],
      );
      return reply.status(204).send();
    });
  });

  fastify.get("/audit/events", auth, async (request: any) => {
    const user = await requireAuth(fastify, request);
    const filters = filtersFrom(request.query);
    await requireAuditPermission(pool, filters.organizationId, user.id, "audit:read");
    const requestedLimit = Number(request.query?.limit ?? 50);
    const limit =
      Number.isInteger(requestedLimit) && requestedLimit >= 1 && requestedLimit <= 200
        ? requestedLimit
        : 50;
    return queryEvents(pool, filters, decodeCursor(request.query?.cursor), limit);
  });

  fastify.post("/audit/exports", auth, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const filters = filtersFrom(request.body);
    await requireAuditPermission(pool, filters.organizationId, user.id, "audit:export");
    const jobId = randomUUID();
    const watermark = `${filters.organizationId}:${user.id}:${new Date().toISOString()}:${jobId}`;
    const exportRequestId = requestIdFrom(request.headers);
    return inTransaction(pool, async (connection) => {
      await connection.query(
        `INSERT INTO ai_direct_audit_export_jobs
         (id, organizationId, requestedByUserId, status, filters, watermark, requestId)
         VALUES (?, ?, ?, 'queued', CAST(? AS JSON), ?, ?)`,
        [
          jobId,
          filters.organizationId,
          user.id,
          JSON.stringify({
            ...filters,
            from: filters.from.toISOString(),
            to: filters.to.toISOString(),
          }),
          watermark,
          exportRequestId,
        ],
      );
      await connection.query(
        `INSERT INTO ai_direct_audit_events
         (id, organizationId, actorUserId, action, targetType, targetId, requestId, outcome, metadata)
         VALUES (?, ?, ?, 'audit.export.requested', 'audit_export', ?, ?, 'queued', CAST(? AS JSON))`,
        [
          randomUUID(),
          filters.organizationId,
          user.id,
          jobId,
          exportRequestId,
          JSON.stringify({
            from: filters.from.toISOString(),
            to: filters.to.toISOString(),
            watermark,
          }),
        ],
      );
      return reply.status(202).send({ id: jobId, status: "queued" });
    });
  });

  fastify.get("/audit/exports/:id", auth, async (request: any) => {
    const user = await requireAuth(fastify, request);
    const organizationId = requiredText(request.query?.organizationId, "organizationId", 36);
    await requireAuditPermission(pool, organizationId, user.id, "audit:export");
    const [rows] = await pool.query(
      `SELECT id, organizationId, status, watermark, artifactMimeType, artifactFileName,
              artifactSizeBytes, artifactSha256, failureCode, createdAt, startedAt, completedAt
       FROM ai_direct_audit_export_jobs WHERE id = ? AND organizationId = ? LIMIT 1`,
      [request.params.id, organizationId],
    );
    const job = (rows as Array<Record<string, unknown>>)[0];
    if (!job) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "导出任务不存在", 404);
    return {
      ...job,
      artifactSizeBytes:
        job.artifactSizeBytes === null || job.artifactSizeBytes === undefined
          ? null
          : String(job.artifactSizeBytes),
    };
  });

  fastify.post("/audit/exports/:id/download-token", auth, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const organizationId = requiredText(request.body?.organizationId, "organizationId", 36);
    await requireAuditPermission(pool, organizationId, user.id, "audit:export");
    const generated = createDownloadToken();
    return inTransaction(pool, async (connection) => {
      const [jobs] = await connection.query(
        `SELECT id FROM ai_direct_audit_export_jobs
         WHERE id = ? AND organizationId = ? AND status = 'completed' AND artifact IS NOT NULL LIMIT 1 FOR UPDATE`,
        [request.params.id, organizationId],
      );
      if (!(jobs as unknown[])[0]) {
        throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "已完成的导出产物不存在", 404);
      }
      await connection.query(
        `INSERT INTO ai_direct_audit_export_download_tokens
         (id, exportJobId, organizationId, tokenPrefix, tokenHash, issuedToUserId, expiresAt)
         VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL ? SECOND))`,
        [
          generated.id,
          request.params.id,
          organizationId,
          generated.tokenPrefix,
          generated.tokenHash,
          user.id,
          DOWNLOAD_TOKEN_TTL_SECONDS,
        ],
      );
      await connection.query(
        `INSERT INTO ai_direct_audit_events
         (id, organizationId, actorUserId, action, targetType, targetId, requestId, outcome, metadata)
         VALUES (?, ?, ?, 'audit.export.download_token.issued', 'audit_export', ?, ?, 'success', CAST(? AS JSON))`,
        [
          randomUUID(),
          organizationId,
          user.id,
          request.params.id,
          requestIdFrom(request.headers),
          JSON.stringify({ expiresInSeconds: DOWNLOAD_TOKEN_TTL_SECONDS }),
        ],
      );
      return reply
        .status(201)
        .send({ token: generated.token, expiresInSeconds: DOWNLOAD_TOKEN_TTL_SECONDS });
    });
  });

  fastify.get("/audit/exports/:id/download", async (request: any, reply) => {
    const token = requiredText(request.query?.token, "token", 128);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        `SELECT j.organizationId, t.issuedToUserId, j.artifact, j.artifactMimeType, j.artifactFileName, j.artifactSizeBytes, j.artifactSha256
         FROM ai_direct_audit_export_download_tokens t
         JOIN ai_direct_audit_export_jobs j ON j.id = t.exportJobId
         WHERE t.exportJobId = ? AND t.tokenHash = ? AND t.usedAt IS NULL
           AND t.expiresAt > NOW(3) AND j.status = 'completed' AND j.artifact IS NOT NULL
         LIMIT 1 FOR UPDATE`,
        [request.params.id, hashDownloadToken(token)],
      );
      const artifact = (rows as Array<Record<string, unknown>>)[0];
      if (!artifact)
        throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "下载授权无效或已过期", 404);
      await connection.query(
        `UPDATE ai_direct_audit_export_download_tokens SET usedAt = NOW(3)
         WHERE exportJobId = ? AND tokenHash = ? AND usedAt IS NULL`,
        [request.params.id, hashDownloadToken(token)],
      );
      await connection.query(
        `INSERT INTO ai_direct_audit_events
         (id, organizationId, actorUserId, action, targetType, targetId, requestId, outcome, metadata)
         VALUES (?, ?, ?, 'audit.export.downloaded', 'audit_export', ?, ?, 'success', CAST(? AS JSON))`,
        [
          randomUUID(),
          artifact.organizationId,
          artifact.issuedToUserId,
          request.params.id,
          requestIdFrom(request.headers),
          JSON.stringify({ artifactSha256: artifact.artifactSha256 }),
        ],
      );
      await connection.commit();
      reply.header("Content-Type", String(artifact.artifactMimeType || "application/octet-stream"));
      reply.header(
        "Content-Disposition",
        `attachment; filename="${String(artifact.artifactFileName || "audit-export").replace(/["\\\r\n]/g, "_")}"`,
      );
      reply.header("Content-Length", String(artifact.artifactSizeBytes));
      reply.header("Digest", `sha-256=${artifact.artifactSha256}`);
      reply.header("Cache-Control", "private, no-store");
      return reply.send(artifact.artifact);
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  });
}
