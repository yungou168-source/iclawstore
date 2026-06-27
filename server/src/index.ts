/**
 * ClawHub API Server (Simplified)
 * Fastify + Prisma + Meilisearch
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { PrismaClient } from "../../node_modules/.prisma/client/index.js";

// Routes
import { skillsRoutes } from "./routes/skills.js";
import { usersRoutes } from "./routes/users.js";

const prisma = new PrismaClient();

const fastify = Fastify({
  logger: true,
});

await fastify.register(cors, {
  origin: true,
  credentials: true,
});

await fastify.register(jwt, {
  secret: process.env.JWT_SECRET || "change-me-in-production",
});

// 认证装饰器
fastify.decorate("authenticate", async function (request, reply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({ error: "Unauthorized" });
  }
});

fastify.decorate("prisma", prisma);

// 健康检查
fastify.get("/health", async () => {
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  };
});

// 注册路由
await fastify.register(skillsRoutes, { prefix: "/api/skills" });
await fastify.register(usersRoutes, { prefix: "/api/users" });

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
