import { afterEach, describe, expect, it } from "bun:test";
import Fastify, { FastifyInstance } from "fastify";
import { aiDirectCoreRoutes } from "../src/routes/aiDirectCore.js";

const apps: FastifyInstance[] = [];

const createApp = async (): Promise<FastifyInstance> => {
  const app = Fastify({ logger: false });
  apps.push(app);
  app.decorate("mysql", {});
  app.decorate("authenticate", async () => {
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  });
  await app.register(aiDirectCoreRoutes, { prefix: "/api/v1/ai-direct-hiring" });
  await app.ready();
  return app;
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("aiDirectCoreRoutes", () => {
  for (const path of [
    "/api/v1/ai-direct-hiring/session",
    "/api/v1/ai-direct-hiring/agents",
    "/api/v1/ai-direct-hiring/agents/agent-1/versions",
    "/api/v1/ai-direct-hiring/catalog/agents",
    "/api/v1/ai-direct-hiring/catalog/agents/agent-1",
    "/api/v1/ai-direct-hiring/catalog/categories",
    "/api/v1/ai-direct-hiring/organizations",
    "/api/v1/ai-direct-hiring/companies",
    "/api/v1/ai-direct-hiring/workforce/departments?companyId=company-1",
    "/api/v1/ai-direct-hiring/workforce/positions/position-1/candidate-matches",
    "/api/v1/ai-direct-hiring/offers",
    "/api/v1/ai-direct-hiring/interviews/interview-1/messages",
    "/api/v1/ai-direct-hiring/approvals",
    "/api/v1/ai-direct-hiring/jobs?organizationId=org-1",
    "/api/v1/ai-direct-hiring/worker-tokens?organizationId=org-1",
    "/api/v1/ai-direct-hiring/runtime/metrics?organizationId=org-1",
    "/api/v1/ai-direct-hiring/workers/lease",
  ]) {
    it(`mounts ${path} behind authentication`, async () => {
      const app = await createApp();
      const response = await app.inject({ method: "GET", url: path });
      expect(response.statusCode).toBe(401);
    });
  }
});
