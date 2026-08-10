import { describe, expect, it, vi } from "bun:test";
import type { Pool, ResultSetHeader } from "mysql2/promise";
import {
  createFriendlyLink,
  deleteFriendlyLink,
  listPublicFriendlyLinks,
  updateFriendlyLink,
} from "../src/services/friendlyLinks.js";

const row = {
  id: "link-1",
  label: "Example",
  url: "https://example.com/",
  description: null,
  sortOrder: 10,
  isActive: 1,
  createdAt: new Date("2026-08-10T00:00:00Z"),
  updatedAt: new Date("2026-08-10T00:00:00Z"),
};

describe("friendlyLinks service", () => {
  it("lists only the bounded public ordering and normalizes booleans", async () => {
    const query = vi.fn(async () => [[row], []]);
    const items = await listPublicFriendlyLinks({ query } as unknown as Pool);

    expect(items).toEqual([{ ...row, isActive: true }]);
    expect(String(query.mock.calls[0]?.[0])).toContain("WHERE isActive = TRUE");
    expect(String(query.mock.calls[0]?.[0])).toContain("LIMIT 100");
  });

  it("creates and reloads a link with the authenticated actor", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("INSERT")) return [{ affectedRows: 1 } as ResultSetHeader, []];
      return [[row], []];
    });
    const created = await createFriendlyLink(
      { query } as unknown as Pool,
      { label: row.label, url: row.url, description: null, sortOrder: 10, isActive: true },
      "admin-1",
    );

    expect(created.label).toBe("Example");
    expect(query.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(["admin-1", "admin-1"]));
  });

  it("updates and deletes existing links", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("UPDATE") || sql.startsWith("DELETE")) {
        return [{ affectedRows: 1 } as ResultSetHeader, []];
      }
      return [[row], []];
    });
    const pool = { query } as unknown as Pool;

    await updateFriendlyLink(
      pool,
      row.id,
      { label: row.label, url: row.url, description: null, sortOrder: 20, isActive: false },
      "admin-1",
    );
    await deleteFriendlyLink(pool, row.id);

    expect(query).toHaveBeenCalledTimes(3);
  });
});
