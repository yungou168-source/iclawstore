import type { FastifyInstance } from "fastify";
import type { RowDataPacket } from "mysql2/promise";
import { requireAuth } from "../middleware/aiDirectAuth.js";
import { AiDirectHiringError, ErrorCodes } from "../services/aiDirectErrors.js";
import { TemplateReviewService } from "../services/templateReview.js";

export async function desktopTemplateReviewRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new TemplateReviewService(fastify);

  fastify.addHook("preHandler", async (request) => {
    const actor = await requireAuth(fastify, request);
    await service.requireAdmin(actor.id);
  });

  fastify.get("/template-review/queue", async (request, reply) => {
    const query = request.query as { cursor?: string; limit?: string };
    const limit = boundedInteger(query.limit, 1, 100, 25);
    return reply.status(200).send(await service.listPending({ cursor: query.cursor, limit }));
  });

  fastify.get("/template-review/versions/:versionId", async (request, reply) => {
    const { versionId } = request.params as { versionId: string };
    return reply.status(200).send(await service.getDetail(versionId));
  });

  fastify.post("/template-review/versions/:versionId/approve", async (request, reply) => {
    const actor = await requireAuth(fastify, request);
    const { versionId } = request.params as { versionId: string };
    const body = requireBody(request.body, ["reason"]);
    const reason = optionalString(body.reason, "reason", 2000);
    return reply.status(200).send(
      await service.decide({
        actorUserId: actor.id,
        versionId,
        decision: "approved",
        reason,
        requestId: request.id,
      }),
    );
  });

  fastify.post("/templates/:templateId/versions/:versionId/approve", async (request, reply) => {
    const actor = await requireAuth(fastify, request);
    const { templateId, versionId } = request.params as { templateId: string; versionId: string };
    const body = requireBody(request.body, ["reason"]);
    const reason = optionalString(body.reason, "reason", 2000);
    await service.requireVersionTemplate(versionId, templateId);
    return reply.status(200).send(
      await service.decide({
        actorUserId: actor.id,
        versionId,
        decision: "approved",
        reason,
        requestId: request.id,
      }),
    );
  });

  fastify.post("/template-review/versions/:versionId/reject", async (request, reply) => {
    const actor = await requireAuth(fastify, request);
    const { versionId } = request.params as { versionId: string };
    const body = requireBody(request.body, ["reason"]);
    const reason = requiredString(body.reason, "reason", 2000);
    return reply.status(200).send(
      await service.decide({
        actorUserId: actor.id,
        versionId,
        decision: "rejected",
        reason,
        requestId: request.id,
      }),
    );
  });

  fastify.post("/template-review/versions/:versionId/publish", async (request, reply) => {
    const actor = await requireAuth(fastify, request);
    const { versionId } = request.params as { versionId: string };
    return reply.status(200).send(
      await service.setPublication({
        actorUserId: actor.id,
        versionId,
        publish: true,
        requestId: request.id,
      }),
    );
  });

  fastify.post("/template-review/versions/:versionId/unpublish", async (request, reply) => {
    const actor = await requireAuth(fastify, request);
    const { versionId } = request.params as { versionId: string };
    return reply.status(200).send(
      await service.setPublication({
        actorUserId: actor.id,
        versionId,
        publish: false,
        requestId: request.id,
      }),
    );
  });

  fastify.get("/template-review/templates/:templateId/versions", async (request, reply) => {
    const { templateId } = request.params as { templateId: string };
    const [rows] = await fastify.mysql.query<RowDataPacket[]>(
      `SELECT id, version, reviewStatus, publicationStatus, submittedAt, reviewedAt, publishedAt,
              sha256, sizeBytes, createdByUserId, createdAt
       FROM desktop_template_versions WHERE templateId = ? ORDER BY createdAt DESC, id DESC`,
      [templateId],
    );
    return reply.status(200).send({ items: rows });
  });

  fastify.get("/template-review/templates/:templateId/entitlements", async (request, reply) => {
    const { templateId } = request.params as { templateId: string };
    const [rows] = await fastify.mysql.query<RowDataPacket[]>(
      `SELECT userId, source, reference, status, grantedByUserId, createdAt, updatedAt, revokedAt
       FROM desktop_template_entitlements WHERE templateId = ? ORDER BY updatedAt DESC, userId`,
      [templateId],
    );
    return reply.status(200).send({ items: rows });
  });

  fastify.put(
    "/template-review/templates/:templateId/entitlements/:userId",
    async (request, reply) => {
      const actor = await requireAuth(fastify, request);
      const { templateId, userId } = request.params as { templateId: string; userId: string };
      const body = requireBody(request.body, ["reference"]);
      const reference = optionalString(body.reference, "reference", 191);
      return reply.status(200).send(
        await service.setEntitlement({
          actorUserId: actor.id,
          templateId,
          userId,
          active: true,
          reference,
          requestId: request.id,
        }),
      );
    },
  );

  fastify.put("/templates/:templateId/entitlements/:userId", async (request, reply) => {
    const actor = await requireAuth(fastify, request);
    const { templateId, userId } = request.params as { templateId: string; userId: string };
    const body = requireBody(request.body, ["reference"]);
    const reference = optionalString(body.reference, "reference", 191);
    return reply.status(200).send(
      await service.setEntitlement({
        actorUserId: actor.id,
        templateId,
        userId,
        active: true,
        reference,
        requestId: request.id,
      }),
    );
  });

  fastify.delete(
    "/template-review/templates/:templateId/entitlements/:userId",
    async (request, reply) => {
      const actor = await requireAuth(fastify, request);
      const { templateId, userId } = request.params as { templateId: string; userId: string };
      await service.setEntitlement({
        actorUserId: actor.id,
        templateId,
        userId,
        active: false,
        reference: null,
        requestId: request.id,
      });
      return reply.status(204).send();
    },
  );

  fastify.delete("/templates/:templateId/entitlements/:userId", async (request, reply) => {
    const actor = await requireAuth(fastify, request);
    const { templateId, userId } = request.params as { templateId: string; userId: string };
    await service.setEntitlement({
      actorUserId: actor.id,
      templateId,
      userId,
      active: false,
      reference: null,
      requestId: request.id,
    });
    return reply.status(204).send();
  });

  fastify.get("/template-review/templates/:templateId/downloads", async (request, reply) => {
    const { templateId } = request.params as { templateId: string };
    const query = request.query as { cursor?: string; limit?: string };
    const limit = boundedInteger(query.limit, 1, 100, 50);
    const beforeId = query.cursor ?? null;
    const [rows] = await fastify.mysql.query<RowDataPacket[]>(
      `SELECT id, templateVersionId, userId, entitlementSource, requestId, downloadedAt
       FROM desktop_template_download_events
       WHERE templateId = ? AND (? IS NULL OR id < ?)
       ORDER BY downloadedAt DESC, id DESC LIMIT ?`,
      [templateId, beforeId, beforeId, limit + 1],
    );
    const items = rows.slice(0, limit);
    return reply.status(200).send({
      items,
      nextCursor: rows.length > limit ? String(items.at(-1)?.id ?? "") : null,
    });
  });
}

function boundedInteger(
  value: string | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function requireBody(value: unknown, allowedKeys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "请求正文必须是对象");
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !allowedKeys.includes(key))) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "请求正文包含未知字段");
  }
  return body;
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > maxLength) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 不合法`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredString(value, field, maxLength);
}
