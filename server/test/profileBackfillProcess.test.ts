import { describe, expect, it, vi } from "bun:test";
import {
  runProfileBackfill,
  runProfileBackfillToCompletion,
  runProfileIncrementalSync,
  runProfileIncrementalSyncToCompletion,
} from "../src/profileBackfillProcess.js";

const snapshot = {
  legacyConvexId: "users:1",
  legacyCreationTime: 1,
  name: "alice",
  handle: "alice",
  profileSlug: "alice",
  displayName: "Alice",
  bio: null,
  image: null,
  imageStorageId: null,
  developerStatus: null,
  developerAppliedAt: null,
  developerApprovedAt: null,
  role: "user",
  trustedPublisher: false,
  publishedSkills: 0,
  totalStars: 0,
  totalDownloads: 0,
  personalPublisherLegacyConvexId: null,
  deletedAt: null,
  deactivatedAt: null,
  purgedAt: null,
  banReason: null,
  legacyCreatedAt: null,
  legacyUpdatedAt: null,
};

const poolFor = (cursorDone = false) => {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("SELECT sourceCursor, status"))
      return [[{ sourceCursor: null, status: cursorDone ? "completed" : "running" }], []];
    if (sql.includes("SELECT id, sourceHash")) return [[], []];
    if (sql.includes("SELECT targetId")) return [[], []];
    if (sql.includes("SELECT id FROM profile_snapshots")) return [[{ id: "mysql-profile-1" }], []];
    return [{ affectedRows: 1 }, []];
  });
  return { query };
};

describe("profile backfill", () => {
  it("persists the cursor only after profile upserts and can resume idempotently", async () => {
    const pool = poolFor();
    const convex = {
      query: vi.fn(async () => ({
        items: [{ ...snapshot, image: "https://source.invalid/avatar", imageStorageId: "storage:avatar" }],
        cursor: "next",
        done: false,
      })),
    };
    const first = await runProfileBackfill({
      pool: pool as never,
      convex: convex as never,
      batchId: "batch-1",
      batchSize: 10,
    });
    expect(first).toEqual({ batchId: "batch-1", upserted: 1, unchanged: 0, done: false });
    expect(
      pool.query.mock.calls.some(
        ([sql, params]) =>
          String(sql).includes("INSERT INTO convex_exit_outbox_events") &&
          Array.isArray(params) &&
          params.some((value) => value === "profile-avatar:storage:avatar:1"),
      ),
    ).toBe(true);
  });

  it("does not invoke Convex after a completed cursor is resumed", async () => {
    const pool = poolFor(true);
    const convex = { query: vi.fn() };
    const result = await runProfileBackfill({
      pool: pool as never,
      convex: convex as never,
      batchId: "batch-1",
      batchSize: 10,
    });
    expect(result.done).toBe(true);
    expect(convex.query).not.toHaveBeenCalled();
  });

  it("continues through every cursor page and aggregates outcomes", async () => {
    let cursorValue: string | null = null;
    let isComplete = false;
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT sourceCursor, status"))
        return [[{ sourceCursor: cursorValue, status: isComplete ? "completed" : "running" }], []];
      if (sql.includes("SELECT id, sourceHash")) return [[], []];
      if (sql.includes("SELECT targetId")) return [[], []];
      if (sql.includes("SELECT id FROM profile_snapshots"))
        return [[{ id: "mysql-profile-1" }], []];
      if (sql.includes("UPDATE convex_exit_migration_batches") && sql.includes("sourceCursor")) {
        cursorValue = (params as unknown[])[0] as string | null;
        isComplete = Boolean((params as unknown[])[6]);
      }
      return [{ affectedRows: 1 }, []];
    });
    const pool = { query };
    const convex = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ items: [snapshot], cursor: "cursor-2", done: false })
        .mockResolvedValueOnce({
          items: [{ ...snapshot, legacyConvexId: "users:2" }],
          cursor: null,
          done: true,
        }),
    };

    await expect(
      runProfileBackfillToCompletion({
        pool: pool as never,
        convex: convex as never,
        batchId: "batch-1",
        batchSize: 10,
      }),
    ).resolves.toEqual({ batchId: "batch-1", upserted: 2, unchanged: 0, done: true });
    expect(convex.query).toHaveBeenNthCalledWith(1, expect.anything(), {
      cursor: undefined,
      limit: 10,
    });
    expect(convex.query).toHaveBeenNthCalledWith(2, expect.anything(), {
      cursor: "cursor-2",
      limit: 10,
    });
  });

  it("repairs a missing legacy ID map when a retry finds an unchanged snapshot", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT sourceCursor, status"))
        return [[{ sourceCursor: "resume-here", status: "running" }], []];
      if (sql.includes("SELECT id, sourceHash")) {
        const { createHash } = await import("node:crypto");
        return [
          [
            {
              id: "mysql-profile-1",
              sourceHash: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
            },
          ],
          [],
        ];
      }
      if (sql.includes("SELECT targetId")) return [[], []];
      return [{ affectedRows: 1 }, []];
    });
    const pool = { query };
    const convex = { query: vi.fn(async () => ({ items: [snapshot], cursor: null, done: true })) };

    await expect(
      runProfileBackfill({
        pool: pool as never,
        convex: convex as never,
        batchId: "batch-1",
        batchSize: 10,
      }),
    ).resolves.toEqual({ batchId: "batch-1", upserted: 0, unchanged: 1, done: true });
    expect(convex.query).toHaveBeenCalledWith(expect.anything(), {
      cursor: "resume-here",
      limit: 10,
    });
    expect(
      query.mock.calls.some(
        ([sql, params]) =>
          String(sql).includes("INSERT INTO convex_exit_legacy_id_maps") &&
          JSON.stringify(params) === JSON.stringify(["profiles", "users:1", "mysql-profile-1"]),
      ),
    ).toBe(true);
  });

  it("rejects a legacy Convex ID that already maps to another MySQL profile", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT sourceCursor, status"))
        return [[{ sourceCursor: null, status: "running" }], []];
      if (sql.includes("SELECT id, sourceHash")) {
        const { createHash } = await import("node:crypto");
        return [
          [
            {
              id: "mysql-profile-1",
              sourceHash: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
            },
          ],
          [],
        ];
      }
      if (sql.includes("SELECT targetId"))
        return [[{ targetId: "different-profile" }], []];
      return [{ affectedRows: 1 }, []];
    });
    const pool = { query };
    const convex = { query: vi.fn(async () => ({ items: [snapshot], cursor: null, done: true })) };

    await expect(
      runProfileBackfill({
        pool: pool as never,
        convex: convex as never,
        batchId: "batch-1",
        batchSize: 10,
      }),
    ).rejects.toThrow("Legacy Convex ID maps to a different target ID");
    expect(query.mock.calls.some(([sql]) => String(sql).includes("SET status = 'failed'"))).toBe(
      true,
    );
    expect(
      query.mock.calls.some(
        ([sql]) =>
          String(sql).includes("UPDATE convex_exit_migration_batches") &&
          String(sql).includes("sourceCursor"),
      ),
    ).toBe(false);
  });

  it("keeps an incremental watermark stable across a resumed source cursor", async () => {
    let cursorValue: string | null = null;
    let isComplete = false;
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT sourceCursor, status"))
        return [[{ sourceCursor: cursorValue, status: isComplete ? "completed" : "running" }], []];
      if (sql.includes("SELECT id, sourceHash")) return [[], []];
      if (sql.includes("SELECT targetId")) return [[], []];
      if (sql.includes("SELECT id FROM profile_snapshots")) return [[{ id: "mysql-profile-1" }], []];
      if (sql.includes("UPDATE convex_exit_migration_batches") && sql.includes("sourceCursor")) {
        cursorValue = (params as unknown[])[0] as string | null;
        isComplete = Boolean((params as unknown[])[6]);
      }
      return [{ affectedRows: 1 }, []];
    });
    const convex = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ items: [snapshot], cursor: "source-next", done: false, watermark: 10_000 })
        .mockResolvedValueOnce({ items: [snapshot], cursor: null, done: true, watermark: 10_000 }),
    };

    await runProfileIncrementalSync({
      pool: { query } as never,
      convex: convex as never,
      batchId: "incremental-1",
      batchSize: 10,
      updatedAfter: 9_500,
      overlapMs: 250,
    });
    const second = await runProfileIncrementalSync({
      pool: { query } as never,
      convex: convex as never,
      batchId: "incremental-1",
      batchSize: 10,
      updatedAfter: 9_500,
      overlapMs: 250,
    });

    expect(second).toMatchObject({ done: true, watermark: 10_000 });
    expect(convex.query).toHaveBeenNthCalledWith(1, expect.anything(), {
      cursor: undefined,
      limit: 10,
      updatedAfter: 9_250,
      updatedBefore: undefined,
    });
    expect(convex.query).toHaveBeenNthCalledWith(2, expect.anything(), {
      cursor: "source-next",
      limit: 10,
      updatedAfter: 9_250,
      updatedBefore: 10_000,
    });
  });

  it("runs every incremental page with a bounded inter-page delay", async () => {
    let cursorValue: string | null = null;
    let isComplete = false;
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT sourceCursor, status"))
        return [[{ sourceCursor: cursorValue, status: isComplete ? "completed" : "running" }], []];
      if (sql.includes("SELECT id, sourceHash")) return [[], []];
      if (sql.includes("SELECT targetId")) return [[], []];
      if (sql.includes("SELECT id FROM profile_snapshots")) return [[{ id: "mysql-profile-1" }], []];
      if (sql.includes("UPDATE convex_exit_migration_batches") && sql.includes("sourceCursor")) {
        cursorValue = (params as unknown[])[0] as string | null;
        isComplete = Boolean((params as unknown[])[6]);
      }
      return [{ affectedRows: 1 }, []];
    });
    const convex = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ items: [snapshot], cursor: "source-next", done: false, watermark: 10_000 })
        .mockResolvedValueOnce({ items: [snapshot], cursor: null, done: true, watermark: 10_000 }),
    };

    await expect(
      runProfileIncrementalSyncToCompletion({
        pool: { query } as never,
        convex: convex as never,
        batchId: "incremental-completion",
        batchSize: 10,
        updatedAfter: 9_500,
        overlapMs: 250,
        delayMs: 0,
      }),
    ).resolves.toEqual({
      batchId: "incremental-completion",
      upserted: 2,
      unchanged: 0,
      done: true,
      watermark: 10_000,
    });
    expect(convex.query).toHaveBeenCalledTimes(2);
  });

  it("records an incremental source failure without advancing the cursor", async () => {
    const pool = poolFor();
    const convex = { query: vi.fn(async () => { throw new Error("Convex unavailable"); }) };

    await expect(
      runProfileIncrementalSync({
        pool: pool as never,
        convex: convex as never,
        batchId: "incremental-failure",
        batchSize: 10,
        updatedAfter: 1,
        overlapMs: 0,
      }),
    ).rejects.toThrow("Convex unavailable");
    expect(
      pool.query.mock.calls.some(
        ([sql]) =>
          String(sql).includes("UPDATE convex_exit_migration_batches") &&
          String(sql).includes("sourceCursor"),
      ),
    ).toBe(false);
  });
});
