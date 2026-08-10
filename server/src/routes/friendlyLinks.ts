import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireAuth } from "../middleware/aiDirectAuth.js";
import { AiDirectHiringError, ErrorCodes } from "../services/aiDirectErrors.js";
import {
  createFriendlyLink,
  deleteFriendlyLink,
  FriendlyLinkNotFoundError,
  listFriendlyLinksForAdmin,
  listPublicFriendlyLinks,
  updateFriendlyLink,
  type FriendlyLinkInput,
} from "../services/friendlyLinks.js";

const requireAdmin = async (fastify: FastifyInstance, request: FastifyRequest) => {
  const user = await requireAuth(fastify, request);
  if (user.role !== "admin") {
    throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, "需要管理员权限", 403);
  }
  return user;
};

const readInput = (body: unknown): FriendlyLinkInput => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "请求体必须是对象");
  }
  const value = body as Record<string, unknown>;
  const label = typeof value.label === "string" ? value.label.trim() : "";
  if (!label || label.length > 80) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "链接名称长度必须为 1-80 个字符");
  }
  const url = typeof value.url === "string" ? value.url.trim() : "";
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "链接地址格式无效");
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol) || url.length > 2048) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "链接地址必须使用 HTTP 或 HTTPS");
  }
  const description = typeof value.description === "string" ? value.description.trim() : "";
  if (description.length > 240) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "链接说明不能超过 240 个字符");
  }
  const sortOrder = Number(value.sortOrder);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 1_000_000) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "排序值必须是 0-1000000 的整数");
  }
  if (typeof value.isActive !== "boolean") {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "isActive 必须是布尔值");
  }
  return {
    label,
    url: parsedUrl.toString(),
    description: description || null,
    sortOrder,
    isActive: value.isActive,
  };
};

const readId = (request: FastifyRequest): string => {
  const { id } = request.params as { id?: string };
  if (!id || id.length > 64) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "友情链接 ID 格式无效");
  }
  return id;
};

const handleNotFound = (error: unknown): never => {
  if (error instanceof FriendlyLinkNotFoundError) {
    throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, error.message, 404);
  }
  throw error;
};

export async function friendlyLinksRoutes(fastify: FastifyInstance): Promise<void> {
  const pool = fastify.mysql;
  const auth = [fastify.authenticate];

  fastify.get("/friendly-links", async (_request, reply) => {
    const items = await listPublicFriendlyLinks(pool);
    return reply.send({ items });
  });

  fastify.get("/admin/friendly-links", { onRequest: auth }, async (request, reply) => {
    await requireAdmin(fastify, request);
    return reply.send({ items: await listFriendlyLinksForAdmin(pool) });
  });

  fastify.post("/admin/friendly-links", { onRequest: auth }, async (request, reply) => {
    const user = await requireAdmin(fastify, request);
    const item = await createFriendlyLink(pool, readInput(request.body), user.id);
    return reply.status(201).send(item);
  });

  fastify.put("/admin/friendly-links/:id", { onRequest: auth }, async (request, reply) => {
    const user = await requireAdmin(fastify, request);
    try {
      return reply.send(
        await updateFriendlyLink(pool, readId(request), readInput(request.body), user.id),
      );
    } catch (error) {
      handleNotFound(error);
    }
  });

  fastify.delete("/admin/friendly-links/:id", { onRequest: auth }, async (request, reply) => {
    await requireAdmin(fastify, request);
    try {
      await deleteFriendlyLink(pool, readId(request));
      return reply.status(204).send();
    } catch (error) {
      handleNotFound(error);
    }
  });
}
