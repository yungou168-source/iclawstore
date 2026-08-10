import { afterEach, describe, expect, it } from "bun:test";
import Fastify, { type FastifyInstance } from "fastify";
import { aiDirectAuditRoutes } from "../src/routes/aiDirectAudit.js";
import { errorResponse } from "../src/services/aiDirectErrors.js";
import { projectAuditRow, redactAuditMetadata } from "../src/services/auditProjection.js";

type QueryCall = { sql: string; values?: unknown[] };
const apps: FastifyInstance[] = [];

async function createApp(
  query: (sql: string, values?: unknown[]) => Promise<[unknown, unknown?]>,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  apps.push(app);
  app.decorate("authenticate", async (request: { user?: { id: string; role: string } }) => {
    request.user = { id: "user-1", role: "member" };
  });
  const mysql = {
    query,
    getConnection: async () => ({
      query,
      beginTransaction: async () => undefined,
      commit: async () => undefined,
      rollback: async () => undefined,
      release: () => undefined,
    }),
  };
  app.decorate("mysql", mysql);
  app.setErrorHandler((error: any, _request, reply) => {
    reply.status(error.httpStatus ?? 500).send(errorResponse(error));
  });
  await app.register(aiDirectAuditRoutes);
  await app.ready();
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("audit safe projection", () => {
  it("removes prompt, key, full IO, storage paths, and retry payloads recursively", () => {
    const metadata = redactAuditMetadata({
      companyId: "company-1",
      apiKey: "secret",
      prompt: "do not return",
      nested: {
        input: { confidential: true },
        output: "complete answer",
        storagePath: "/private/file",
        internalRetry: { body: "hidden" },
        latencyMs: 17,
      },
    });
    expect(metadata).toEqual({ companyId: "company-1", nested: { latencyMs: 17 } });
  });

  it("only emits the normalized public audit shape", () => {
    const projected = projectAuditRow({
      source: "model_run",
      id: "audit-1",
      organizationId: "org-1",
      actorUserId: "user-1",
      action: "model.run.completed",
      resourceType: "workflow_run",
      resourceId: "run-1",
      requestId: "req-1",
      outcome: "completed",
      metadata: { modelKey: "private-model-key", inputTokens: 4, latencyMs: 10 },
      createdAt: "2026-08-05T12:00:00.000Z",
    });
    expect(projected.metadata).toEqual({ inputTokens: 4, latencyMs: 10 });
    expect(JSON.stringify(projected)).not.toContain("private-model-key");
  });
});

describe("aiDirectAuditRoutes", () => {
  it("requires organization and bounded time filters before querying events", async () => {
    const calls: QueryCall[] = [];
    const app = await createApp(async (sql, values) => {
      calls.push({ sql, values });
      return [[], []];
    });
    const missing = await app.inject({ method: "GET", url: "/audit/events?organizationId=org-1" });
    const tooWide = await app.inject({
      method: "GET",
      url: "/audit/events?organizationId=org-1&from=2026-01-01T00:00:00.000Z&to=2026-08-01T00:00:00.000Z",
    });
    expect(missing.statusCode).toBe(400);
    expect(tooWide.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("uses owner/admin or explicit grant gating and a stable union cursor query", async () => {
    const calls: QueryCall[] = [];
    const app = await createApp(async (sql, values) => {
      calls.push({ sql, values });
      if (sql.includes("SELECT 1 AS allowed")) return [[{ allowed: 1 }], []];
      return [
        [
          {
            source: "domain",
            id: "event-1",
            organizationId: "org-1",
            actorUserId: "user-2",
            action: "employment.accepted",
            resourceType: "employment",
            resourceId: "employment-1",
            requestId: "req-1",
            outcome: "success",
            metadata: { prompt: "hidden", companyId: "company-1" },
            createdAt: "2026-08-05T12:00:00.000Z",
          },
        ],
        [],
      ];
    });
    const response = await app.inject({
      method: "GET",
      url: "/audit/events?organizationId=org-1&from=2026-08-01T00:00:00.000Z&to=2026-08-06T00:00:00.000Z&actor=user-2&resource=employment-1&action=employment.accepted&requestId=req-1",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0].metadata).toEqual({ companyId: "company-1" });
    expect(calls[0]?.sql).toContain("m.role IN ('owner', 'admin')");
    expect(calls[0]?.sql).toContain("g.action = ?");
    expect(calls[1]?.sql).toContain("UNION ALL");
    expect(calls[1]?.sql).toContain("ORDER BY createdAt DESC, source ASC, id DESC");
    expect(calls[1]?.values).toContain("org-1");
  });

  it("rejects members without an explicit audit grant", async () => {
    const app = await createApp(async () => [[], []]);
    const response = await app.inject({
      method: "GET",
      url: "/audit/events?organizationId=org-1&from=2026-08-01T00:00:00.000Z&to=2026-08-06T00:00:00.000Z",
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("FORBIDDEN_SCOPE");
  });

  it("only queues exports and never executes the event union synchronously", async () => {
    const calls: QueryCall[] = [];
    const app = await createApp(async (sql, values) => {
      calls.push({ sql, values });
      if (sql.includes("SELECT 1 AS allowed")) return [[{ allowed: 1 }], []];
      return [{ affectedRows: 1 }, []];
    });
    const response = await app.inject({
      method: "POST",
      url: "/audit/exports",
      payload: {
        organizationId: "org-1",
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-08-06T00:00:00.000Z",
      },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json().status).toBe("queued");
    expect(calls.some((call) => call.sql.includes("INSERT INTO ai_direct_audit_export_jobs"))).toBe(
      true,
    );
    expect(calls.some((call) => call.sql.includes("UNION ALL"))).toBe(false);
  });
});
