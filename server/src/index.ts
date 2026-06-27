/**
 * ClawHub API Server
 * Fastify + Prisma + Meilisearch
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { PrismaClient } from "@prisma/client";
import { MeiliSearch } from "meilisearch";

// Routes
import { authRoutes } from "./routes/auth.js";
import { skillsRoutes } from "./routes/skills.js";
import { usersRoutes } from "./routes/users.js";
import { searchRoutes } from "./routes/search.js";
import { packagesRoutes } from "./routes/packages.js";

// 创建客户端
export const prisma = new PrismaClient();
export const meili = new MeiliSearch({
  host: process.env.MEILISEARCH_HOST || "http://localhost:7700",
  apiKey: process.env.MEILISEARCH_API_KEY,
});

// 创建 Fastify 实例
const fastify = Fastify({
  logger: true,
});

// 注册插件
await fastify.register(cors, {
  origin: true,
  credentials: true,
});

await fastify.register(jwt, {
  secret: process.env.JWT_SECRET || "change-me-in-production",
});

await fastify.register(multipart, {
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
  },
});

// Swagger 文档
await fastify.register(swagger, {
  openapi: {
    info: {
      title: "ClawHub API",
      description: "API for ClawHub - Skill Registry",
      version: "1.0.0",
    },
    servers: [
      { url: "http://localhost:3001", description: "Local" },
      { url: "https://api.iclawstore.com", description: "Production" },
    ],
  },
});

await fastify.register(swaggerUi, {
  routePrefix: "/docs",
});

// 装饰器：添加 prisma 和 meili
fastify.decorate("prisma", prisma);
fastify.decorate("meili", meili);

// 健康检查
fastify.get("/health", async () => {
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  };
});

// 注册路由
await fastify.register(authRoutes, { prefix: "/api/auth" });
await fastify.register(skillsRoutes, { prefix: "/api/skills" });
await fastify.register(usersRoutes, { prefix: "/api/users" });
await fastify.register(searchRoutes, { prefix: "/api/search" });
await fastify.register(packagesRoutes, { prefix: "/api/packages" });

// 错误处理
fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error(error);
  reply.status(error.statusCode || 500).send({
    error: error.message,
    code: error.code,
  });
});

// 启动服务器
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || "3001");
    await fastify.listen({ port, host: "0.0.0.0" });
    console.log(`🚀 Server running at http://localhost:${port}`);
    console.log(`📚 API docs at http://localhost:${port}/docs`);
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
