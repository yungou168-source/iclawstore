import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { AiDirectHiringError, ErrorCodes } from "./aiDirectErrors.js";

export type ReviewDecision = "approved" | "rejected";

type ReviewCursor = { submittedAt: string; id: string };

interface QueueRow extends RowDataPacket {
  id: string;
  templateId: string;
  version: string;
  reviewStatus: string;
  publicationStatus: string;
  submittedAt: Date | string;
  templateName: string;
  templateSlug: string;
  publisherId: string;
  publisherName: string;
  sha256: string;
}

export class TemplateReviewService {
  constructor(private readonly fastify: FastifyInstance) {}

  async requireAdmin(userId: string): Promise<void> {
    const [rows] = await this.fastify.mysql.query<RowDataPacket[]>(
      `SELECT id FROM users WHERE id = ? AND role = 'admin' AND deletedAt IS NULL LIMIT 1`,
      [userId],
    );
    if (!rows[0])
      throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, "需要平台管理员权限", 403);
  }

  async listPending(input: { cursor?: string; limit: number }) {
    const cursor = input.cursor ? decodeCursor(input.cursor) : null;
    const params: unknown[] = [];
    let cursorSql = "";
    if (cursor) {
      cursorSql = "AND (version.submittedAt < ? OR (version.submittedAt = ? AND version.id < ?))";
      params.push(cursor.submittedAt, cursor.submittedAt, cursor.id);
    }
    params.push(input.limit + 1);
    const [rows] = await this.fastify.mysql.query<QueueRow[]>(
      `SELECT version.id, version.templateId, version.version, version.reviewStatus,
              version.publicationStatus, version.submittedAt, version.sha256,
              template.name AS templateName, template.slug AS templateSlug,
              template.publisherId, publisher.displayName AS publisherName
       FROM desktop_template_versions version
       JOIN desktop_templates template ON template.id = version.templateId
       JOIN publishers publisher ON publisher.id = template.publisherId
       WHERE version.reviewStatus = 'pending_review' ${cursorSql}
       ORDER BY version.submittedAt DESC, version.id DESC LIMIT ?`,
      params,
    );
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        hasMore && last
          ? encodeCursor({ submittedAt: new Date(last.submittedAt).toISOString(), id: last.id })
          : null,
    };
  }

  async getDetail(versionId: string) {
    const [versions] = await this.fastify.mysql.query<RowDataPacket[]>(
      `SELECT version.*, template.name AS templateName, template.slug AS templateSlug,
              template.description, template.publisherId, template.activeVersionId,
              template.catalogStatus, publisher.displayName AS publisherName
       FROM desktop_template_versions version
       JOIN desktop_templates template ON template.id = version.templateId
       JOIN publishers publisher ON publisher.id = template.publisherId
       WHERE version.id = ? LIMIT 1`,
      [versionId],
    );
    if (!versions[0]) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "模板版本不存在", 404);
    const [screenshots] = await this.fastify.mysql.query<RowDataPacket[]>(
      `SELECT id, sortOrder, mimeType, sizeBytes, sha256
       FROM desktop_template_screenshots WHERE templateVersionId = ? ORDER BY sortOrder`,
      [versionId],
    );
    const [decisions] = await this.fastify.mysql.query<RowDataPacket[]>(
      `SELECT id, decision, reason, actorUserId, createdAt
       FROM desktop_template_review_decisions WHERE templateVersionId = ? ORDER BY createdAt DESC, id DESC`,
      [versionId],
    );
    return { ...versions[0], screenshots, decisions };
  }

  async requireVersionTemplate(versionId: string, templateId: string): Promise<void> {
    const [rows] = await this.fastify.mysql.query<RowDataPacket[]>(
      "SELECT id FROM desktop_template_versions WHERE id = ? AND templateId = ? LIMIT 1",
      [versionId, templateId],
    );
    if (!rows[0]) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "模板版本不存在", 404);
  }

  async decide(input: {
    actorUserId: string;
    versionId: string;
    decision: ReviewDecision;
    reason: string | null;
    requestId: string;
  }) {
    if (input.decision === "rejected" && !input.reason) {
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "拒绝时必须填写原因");
    }
    return this.transaction(async (connection) => {
      const [rows] = await connection.query<Array<RowDataPacket & { templateId: string }>>(
        `SELECT templateId FROM desktop_template_versions
         WHERE id = ? AND reviewStatus = 'pending_review' LIMIT 1 FOR UPDATE`,
        [input.versionId],
      );
      const version = rows[0];
      if (!version)
        throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, "模板版本不在待审核状态", 409);
      const decisionId = randomUUID();
      await connection.query(
        `INSERT INTO desktop_template_review_decisions
           (id, templateVersionId, decision, reason, actorUserId, requestId, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, NOW(3))`,
        [
          decisionId,
          input.versionId,
          input.decision,
          input.reason,
          input.actorUserId,
          input.requestId,
        ],
      );
      await connection.query(
        `UPDATE desktop_template_versions
         SET reviewStatus = ?, reviewDecisionId = ?, reviewedAt = NOW(3)
         WHERE id = ?`,
        [input.decision, decisionId, input.versionId],
      );
      await this.writeRiskRecords(connection, {
        actorUserId: input.actorUserId,
        action: `template.version.${input.decision}`,
        targetType: "template_version",
        targetId: input.versionId,
        requestId: input.requestId,
        metadata: { reason: input.reason, templateId: version.templateId },
      });
      return { id: input.versionId, reviewStatus: input.decision, reason: input.reason };
    });
  }

  async setPublication(input: {
    actorUserId: string;
    versionId: string;
    publish: boolean;
    requestId: string;
  }) {
    return this.transaction(async (connection) => {
      const [rows] = await connection.query<
        Array<
          RowDataPacket & {
            templateId: string;
            reviewStatus: string;
            publicationStatus: string;
          }
        >
      >(
        `SELECT templateId, reviewStatus, publicationStatus FROM desktop_template_versions
         WHERE id = ? LIMIT 1 FOR UPDATE`,
        [input.versionId],
      );
      const version = rows[0];
      if (!version) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "模板版本不存在", 404);
      if (input.publish && version.reviewStatus !== "approved") {
        throw new AiDirectHiringError(ErrorCodes.APPROVAL_REQUIRED, "模板版本尚未审核通过", 409);
      }
      const [templateRows] = await connection.query<
        Array<RowDataPacket & { activeVersionId: string | null }>
      >("SELECT activeVersionId FROM desktop_templates WHERE id = ? LIMIT 1 FOR UPDATE", [
        version.templateId,
      ]);
      if (!templateRows[0]) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "模板不存在", 404);
      const publicationStatus = input.publish ? "published" : "unpublished";
      if (input.publish) {
        await connection.query(
          `UPDATE desktop_template_versions SET publicationStatus = 'unpublished'
           WHERE templateId = ? AND id <> ? AND publicationStatus = 'published'`,
          [version.templateId, input.versionId],
        );
      }
      await connection.query(
        `UPDATE desktop_template_versions
         SET publicationStatus = ?,
             status = CASE WHEN ? = 'published' THEN 'published' ELSE status END,
             publishedAt = CASE WHEN ? = 'published' THEN NOW(3) ELSE publishedAt END
         WHERE id = ?`,
        [publicationStatus, publicationStatus, publicationStatus, input.versionId],
      );
      if (input.publish) {
        await connection.query(
          `UPDATE desktop_templates SET activeVersionId = ?, catalogStatus = 'published',
               status = 'published', updatedAt = NOW(3) WHERE id = ?`,
          [input.versionId, version.templateId],
        );
      } else {
        await connection.query(
          `UPDATE desktop_templates SET activeVersionId = NULL, catalogStatus = 'unpublished',
               status = 'draft', updatedAt = NOW(3) WHERE id = ? AND activeVersionId = ?`,
          [version.templateId, input.versionId],
        );
      }
      await this.writeRiskRecords(connection, {
        actorUserId: input.actorUserId,
        action: input.publish ? "template.version.published" : "template.version.unpublished",
        targetType: "template_version",
        targetId: input.versionId,
        requestId: input.requestId,
        metadata: { templateId: version.templateId },
      });
      return { id: input.versionId, publicationStatus };
    });
  }

  async setEntitlement(input: {
    actorUserId: string;
    templateId: string;
    userId: string;
    active: boolean;
    reference: string | null;
    requestId: string;
  }) {
    return this.transaction(async (connection) => {
      const [templates] = await connection.query<RowDataPacket[]>(
        "SELECT id FROM desktop_templates WHERE id = ? LIMIT 1 FOR UPDATE",
        [input.templateId],
      );
      if (!templates[0]) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "模板不存在", 404);
      if (input.active) {
        await connection.query(
          `INSERT INTO desktop_template_entitlements
             (id, templateId, userId, source, reference, status, grantedByUserId, createdAt, updatedAt)
           VALUES (?, ?, ?, 'admin_grant', ?, 'active', ?, NOW(3), NOW(3))
           ON DUPLICATE KEY UPDATE source = 'admin_grant', reference = VALUES(reference),
             status = 'active', grantedByUserId = VALUES(grantedByUserId), revokedAt = NULL, updatedAt = NOW(3)`,
          [randomUUID(), input.templateId, input.userId, input.reference, input.actorUserId],
        );
      } else {
        await connection.query(
          `UPDATE desktop_template_entitlements SET status = 'revoked', revokedAt = NOW(3), updatedAt = NOW(3)
           WHERE templateId = ? AND userId = ?`,
          [input.templateId, input.userId],
        );
      }
      await this.writeRiskRecords(connection, {
        actorUserId: input.actorUserId,
        action: input.active ? "template.entitlement.granted" : "template.entitlement.revoked",
        targetType: "template_entitlement",
        targetId: `${input.templateId}:${input.userId}`,
        requestId: input.requestId,
        metadata: { reference: input.reference },
      });
      return {
        templateId: input.templateId,
        userId: input.userId,
        status: input.active ? "active" : "revoked",
      };
    });
  }

  private async transaction<T>(operation: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const connection = await this.fastify.mysql.getConnection();
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

  private async writeRiskRecords(
    connection: PoolConnection,
    input: {
      actorUserId: string;
      action: string;
      targetType: string;
      targetId: string;
      requestId: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    const metadata = JSON.stringify(input.metadata);
    await connection.query(
      `INSERT INTO desktop_template_audit_events
         (id, actorUserId, action, targetType, targetId, requestId, outcome, metadata, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, 'success', CAST(? AS JSON), NOW(3))`,
      [
        randomUUID(),
        input.actorUserId,
        input.action,
        input.targetType,
        input.targetId,
        input.requestId,
        metadata,
      ],
    );
    await connection.query(
      `INSERT INTO desktop_template_outbox
         (id, topic, aggregateType, aggregateId, payload, status, createdAt)
       VALUES (?, ?, ?, ?, CAST(? AS JSON), 'pending', NOW(3))`,
      [randomUUID(), input.action, input.targetType, input.targetId, metadata],
    );
  }
}

function encodeCursor(value: ReviewCursor): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeCursor(value: string): ReviewCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<ReviewCursor>;
    if (
      typeof parsed.submittedAt !== "string" ||
      Number.isNaN(Date.parse(parsed.submittedAt)) ||
      typeof parsed.id !== "string"
    ) {
      throw new Error("invalid");
    }
    return { submittedAt: parsed.submittedAt, id: parsed.id };
  } catch {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "cursor 不合法");
  }
}
