import { describe, expect, it, vi } from "bun:test";
import { aiDirectApprovalsRoutes } from "../src/routes/aiDirectApprovals.js";

type RegisteredRoute = {
  path: string;
  handler: (request: any, reply: any) => Promise<unknown>;
};

function reply() {
  const response = {
    status: vi.fn(() => response),
    send: vi.fn((body: unknown) => body),
  };
  return response;
}

async function routesWith(pool: any) {
  const routes: RegisteredRoute[] = [];
  const fastify = {
    mysql: pool,
    authenticate: vi.fn(),
    get: vi.fn((path: string, _options: unknown, handler: RegisteredRoute["handler"]) => {
      routes.push({ path, handler });
    }),
    post: vi.fn((path: string, _options: unknown, handler: RegisteredRoute["handler"]) => {
      routes.push({ path, handler });
    }),
  };
  await aiDirectApprovalsRoutes(fastify as any);
  return routes;
}

describe("approval routes transaction boundary", () => {
  it("delegates without performing an unlocked pool pre-read", async () => {
    const approval = {
      id: "approval-1",
      organizationId: "org-1",
      targetType: "offer",
      targetId: "offer-1",
      requestedByUserId: "requester-1",
      approverUserId: "old-approver",
      status: "pending",
      expiresAt: null,
      isDue: false,
    };
    const connection = {
      beginTransaction: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
      release: vi.fn(),
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("FROM ai_direct_approvals") && sql.includes("FOR UPDATE")) {
          return [[approval], []];
        }
        if (sql.includes("FROM ai_direct_organization_members")) {
          return [
            [
              {
                role: values?.[1] === "admin-1" ? "admin" : "member",
                status: "active",
              },
            ],
            [],
          ];
        }
        if (sql.startsWith("UPDATE ai_direct_approvals")) {
          return [{ affectedRows: 1 }, []];
        }
        if (sql.includes("MAX(sequence)")) return [[{ nextSequence: 1 }], []];
        return [{ affectedRows: 1 }, []];
      }),
    };
    const pool = {
      query: vi.fn(),
      getConnection: vi.fn(async () => connection),
    };
    const routes = await routesWith(pool);
    const route = routes.find(({ path }) => path === "/approvals/:id/delegate");
    if (!route) throw new Error("delegate route not registered");
    const response = reply();

    const result = await route.handler(
      {
        user: { id: "admin-1" },
        params: { id: "approval-1" },
        body: { toUserId: "new-approver", reason: "handoff" },
        headers: { "x-request-id": "request-1" },
      },
      response,
    );

    expect(result).toMatchObject({
      approvalId: "approval-1",
      fromUserId: "old-approver",
      toUserId: "new-approver",
    });
    expect(response.status).toHaveBeenCalledWith(201);
    expect(pool.query).not.toHaveBeenCalled();
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });
});
