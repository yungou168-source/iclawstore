import { describe, expect, it, vi } from "bun:test";
import {
  authenticateWorker,
  createWorkerToken,
  revokeWorkerToken,
} from "../src/services/workerTokens.js";

function makePool(rows: unknown[] = []) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const pool = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.includes("SELECT id, organizationId, workerId")) return [rows, []];
      return [{ affectedRows: 1 }, []];
    }),
  };
  return { pool, calls };
}

describe("workerTokens", () => {
  it("stores only a token hash and returns plaintext once", async () => {
    const { pool, calls } = makePool();
    const result = await createWorkerToken(pool as any, {
      organizationId: "org-1",
      workerId: "worker-1",
      name: "Worker 1",
      createdByUserId: "admin-1",
    });
    expect(result.token).toStartWith("adw_");
    const insert = calls.find(({ sql }) => sql.includes("INSERT INTO ai_direct_worker_tokens"))!;
    expect(insert.values).not.toContain(result.token);
    expect(String(insert.values?.[5])).toMatch(/^[a-f0-9]{64}$/);
  });

  it("binds a valid token to its configured worker id", async () => {
    const create = makePool();
    const generated = await createWorkerToken(create.pool as any, {
      organizationId: "org-1",
      workerId: "worker-1",
      name: "Worker 1",
      createdByUserId: "admin-1",
    });
    const storedHash = create.calls.find(({ sql }) => sql.includes("INSERT INTO"))!.values?.[5];
    const auth = makePool([{ id: "token-1", organizationId: "org-1", workerId: "worker-1" }]);
    const identity = await authenticateWorker(auth.pool as any, {
      authorization: `Bearer ${generated.token}`,
      "x-worker-id": "worker-1",
    });
    expect(identity).toEqual({ tokenId: "token-1", organizationId: "org-1", workerId: "worker-1" });
    const select = auth.calls.find(({ sql }) =>
      sql.includes("SELECT id, organizationId, workerId"),
    )!;
    expect(select.values?.[0]).toBe(storedHash);
  });

  it("rejects a token presented by a different worker id", async () => {
    const { pool } = makePool([{ id: "token-1", organizationId: "org-1", workerId: "worker-1" }]);
    await expect(
      authenticateWorker(pool as any, {
        authorization: `Bearer adw_${"a".repeat(43)}`,
        "x-worker-id": "worker-2",
      }),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED", httpStatus: 401 });
  });

  it("revokes only an active token in the requested organization", async () => {
    const { pool } = makePool();
    await expect(revokeWorkerToken(pool as any, "token-1", "org-1")).resolves.toBe(true);
  });
});
