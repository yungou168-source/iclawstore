import { afterEach, describe, expect, it } from "bun:test";
import jwt from "@fastify/jwt";
import Fastify, { type FastifyInstance } from "fastify";
import { desktopTemplateReviewRoutes } from "../src/routes/desktopTemplateReview.js";
import { AiDirectHiringError, errorResponse } from "../src/services/aiDirectErrors.js";

const apps: FastifyInstance[] = [];

class FakeReviewMysql {
  admins = new Set<string>();
  pending = [
    {
      id: "version-1",
      templateId: "template-1",
      version: "1.0.0",
      reviewStatus: "pending_review",
      publicationStatus: "unpublished",
      submittedAt: new Date("2026-08-12T10:00:00.000Z"),
      sha256: "a".repeat(64),
      templateName: "工作台",
      templateSlug: "workbench",
      publisherId: "publisher-1",
      publisherName: "Publisher",
    },
  ];
  writes: string[] = [];
  committed = false;

  async query(sql: string, params: unknown[] = []): Promise<[unknown[], unknown]> {
    if (sql.includes("FROM users WHERE id = ? AND role = 'admin'")) {
      return [this.admins.has(String(params[0])) ? [{ id: params[0] }] : [], {}];
    }
    if (sql.includes("WHERE version.reviewStatus = 'pending_review'")) return [this.pending, {}];
    throw new Error(`Unexpected query: ${sql}`);
  }

  async getConnection() {
    const owner = this;
    return {
      beginTransaction: async () => undefined,
      commit: async () => {
        owner.committed = true;
      },
      rollback: async () => undefined,
      release: () => undefined,
      query: async (sql: string) => {
        owner.writes.push(sql);
        if (sql.includes("SELECT templateId FROM desktop_template_versions")) {
          return [[{ templateId: "template-1" }], {}];
        }
        return [[], { affectedRows: 1 }];
      },
    };
  }
}

async function createApp(mysql: FakeReviewMysql) {
  const app = Fastify({ logger: false });
  apps.push(app);
  await app.register(jwt, { secret: "template-review-test-secret" });
  app.decorate("mysql", mysql as never);
  app.decorate("authenticate", async (request) => request.jwtVerify());
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AiDirectHiringError)
      return reply.status(error.httpStatus).send(errorResponse(error));
    return reply.status(500).send(errorResponse(error));
  });
  await app.register(desktopTemplateReviewRoutes, { prefix: "/api/v1/desktop" });
  await app.ready();
  return { app, token: (id: string) => app.jwt.sign({ id, role: "user" }) };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("desktop template review routes", () => {
  it("checks persisted admin role instead of trusting the JWT role", async () => {
    const mysql = new FakeReviewMysql();
    const { app, token } = await createApp(mysql);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/desktop/template-review/queue",
      headers: { authorization: `Bearer ${token("not-admin")}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("FORBIDDEN_SCOPE");
  });

  it("returns an opaque cursor queue to persisted admins", async () => {
    const mysql = new FakeReviewMysql();
    mysql.admins.add("admin-1");
    const { app, token } = await createApp(mysql);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/desktop/template-review/queue?limit=1",
      headers: { authorization: `Bearer ${token("admin-1")}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{ id: "version-1", reviewStatus: "pending_review" }],
    });
  });

  it("requires a rejection reason before writing a decision", async () => {
    const mysql = new FakeReviewMysql();
    mysql.admins.add("admin-1");
    const { app, token } = await createApp(mysql);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/desktop/template-review/versions/version-1/reject",
      headers: { authorization: `Bearer ${token("admin-1")}` },
      payload: { reason: "   " },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("VALIDATION_ERROR");
    expect(mysql.writes).toHaveLength(0);
  });

  it("commits decision, audit, and outbox together when approving", async () => {
    const mysql = new FakeReviewMysql();
    mysql.admins.add("admin-1");
    const { app, token } = await createApp(mysql);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/desktop/template-review/versions/version-1/approve",
      headers: { authorization: `Bearer ${token("admin-1")}` },
      payload: { reason: "包结构已核验" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: "version-1", reviewStatus: "approved" });
    expect(mysql.committed).toBe(true);
    expect(mysql.writes.some((sql) => sql.includes("desktop_template_review_decisions"))).toBe(
      true,
    );
    expect(mysql.writes.some((sql) => sql.includes("desktop_template_audit_events"))).toBe(true);
    expect(mysql.writes.some((sql) => sql.includes("desktop_template_outbox"))).toBe(true);
  });
});
