import { describe, expect, it, vi } from "bun:test";
import { cleanExpiredInterviewData } from "../src/services/interviewRetentionCleanup.js";

describe("interview retention cleanup", () => {
  it("uses bounded batches and does not delete held rows in the query", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const conn = {
      beginTransaction: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
      release: vi.fn(),
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        queries.push({ sql, values });
        if (sql.includes("SELECT a.id")) return [[{ id: "attachment-1" }], []];
        if (sql.includes("SELECT m.id")) return [[{ id: "message-1" }], []];
        return [{ affectedRows: 1 }, []];
      }),
    };
    const result = await cleanExpiredInterviewData({ getConnection: async () => conn } as any, 999);
    expect(result).toEqual({ deletedAttachments: 1, deletedMessages: 1 });
    expect(
      queries
        .filter((query) => query.sql.includes("LIMIT ?"))
        .every((query) => query.values?.includes(20)),
    ).toBe(true);
    expect(
      queries
        .filter((query) => query.sql.includes("SELECT"))
        .every((query) => query.sql.includes("h.status = 'active'")),
    ).toBe(true);
  });
});
