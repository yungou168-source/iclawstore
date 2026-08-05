/**
 * ClawHub API Server (Simplified)
 * Fastify + Prisma + Meilisearch
 */

import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify, { FastifyReply, FastifyRequest } from "fastify";
import { MeiliSearch } from "meilisearch";
import { createPool } from "mysql2/promise";
import { PrismaClient } from "../../node_modules/.prisma/client/index.js";
import { AuthRequiredError, type AuthenticatedUser } from "./middleware/aiDirectAuth.js";
import { createAiDirectCoreRoutes } from "./routes/aiDirectCore.js";
import { aiDirectMemoryRoutes } from "./routes/aiDirectMemory.js";
import { desktopContractRoutes } from "./routes/desktopContract.js";
import { createDesktopPreferencesRoutes } from "./routes/desktopPreferences.js";
import { createDesktopTemplateRoutes } from "./routes/desktopTemplates.js";
// Routes
import { skillsRoutes } from "./routes/skills.js";
import { usersRoutes } from "./routes/users.js";
import { AiDirectHiringError, errorResponse } from "./services/aiDirectErrors.js";
import {
  createConvexIdentityBridge,
  identityBridgeConfigFromEnvironment,
} from "./services/convexIdentityBridge.js";
import { ManagedAssetStore } from "./services/managedAssetStore.js";

export const prisma = new PrismaClient();
export const meili = new MeiliSearch({
  host: process.env.MEILI_HOST || "http://127.0.0.1:7700",
  apiKey: process.env.MEILI_API_KEY,
});

const fastify = Fastify({
  logger: true,
});

await fastify.register(cors, {
  origin: true,
  credentials: true,
});

await fastify.register(multipart, {
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 1,
    fields: 8,
    parts: 10,
  },
});

fastify.decorate("prisma", prisma);

let authenticateBusinessIdentity:
  | ((authorization: string | undefined) => Promise<AuthenticatedUser>)
  | null = null;
fastify.decorateRequest("user", null);
fastify.decorate("authenticate", async function (request: FastifyRequest) {
  if (!authenticateBusinessIdentity) {
    throw new AuthRequiredError("Convex identity bridge is not configured");
  }
  request.user = await authenticateBusinessIdentity(request.headers.authorization);
});

// Optional MySQL pool for legacy P2 routes (aiDirectHiring et al.).
// Only registered when DATABASE_URL is a mysql:// URL so unit tests, serverless
// bootstraps, and SQLite-backed dev workflows still boot without MySQL.
if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith("mysql")) {
  const pool = createPool({
    uri: process.env.DATABASE_URL,
    waitForConnections: true,
    connectionLimit: 10,
    enableKeepAlive: true,
  });
  fastify.decorate("mysql", pool);
  try {
    const identityBridge = await createConvexIdentityBridge(
      pool,
      identityBridgeConfigFromEnvironment(),
    );
    authenticateBusinessIdentity = identityBridge.authenticate;
  } catch (error) {
    fastify.log.error(
      { err: error },
      "Convex identity bridge unavailable; protected AI Direct Hiring routes remain fail-closed",
    );
  }
  fastify.addHook("onClose", async () => {
    await pool.end();
  });
}

// 健康检查
fastify.get("/health", async () => {
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  };
});

// 错误处理必须先于子路由注册，确保 Fastify 封装上下文继承统一业务错误边界。
fastify.setErrorHandler((error: unknown, _request: FastifyRequest, reply: FastifyReply) => {
  fastify.log.error(error);
  if (error instanceof AiDirectHiringError) {
    return reply.status(error.httpStatus).send(errorResponse(error));
  }
  const statusCode =
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
      ? error.statusCode
      : 500;
  const message = error instanceof Error ? error.message : "Internal Server Error";
  const code =
    typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  reply.status(statusCode).send({ error: message, code });
});

// 注册路由
await fastify.register(skillsRoutes, { prefix: "/api/skills" });
await fastify.register(usersRoutes, { prefix: "/api/users" });
await fastify.register(aiDirectMemoryRoutes, { prefix: "/api/v1" });
await fastify.register(desktopContractRoutes, { prefix: "/api/v1/desktop" });
if (process.env.DATABASE_URL?.startsWith("mysql")) {
  const managedAssetStore = ManagedAssetStore.fromEnvironment();
  await managedAssetStore.initialize();
  await fastify.register(createAiDirectCoreRoutes(managedAssetStore), {
    prefix: "/api/v1/ai-direct-hiring",
  });
  await fastify.register(createDesktopPreferencesRoutes(managedAssetStore), {
    prefix: "/api/v1/desktop",
  });
  await fastify.register(createDesktopTemplateRoutes(managedAssetStore), {
    prefix: "/api/v1/desktop",
  });
}

// 启动服务器
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || "3002");
    await fastify.listen({ port, host: "0.0.0.0" });
    console.log(`🚀 Server running at http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// 关闭时断开 Prisma
process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

start();

export default fastify;
