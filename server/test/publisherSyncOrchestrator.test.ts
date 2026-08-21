import { describe, expect, it, vi } from "bun:test";
import {
  encodePublisherSyncCursor,
  runPublisherSyncPage,
  runPublisherSyncToCompletion,
} from "../src/domains/publishers/publisherSyncOrchestrator.js";

const publisher = {
  legacyConvexId: "publishers:org-1",
  legacyCreationTime: 1,
  kind: "org" as const,
  handle: "acme",
  displayName: "Acme",
  bio: null,
  image: "https://source.invalid/acme.png",
  imageStorageId: "storage:acme",
  linkedUserLegacyConvexId: null,
  trustedPublisher: false,
  publishedSkills: 1,
  publishedPackages: 2,
  totalInstalls: 3,
  totalDownloads: 4,
  totalStars: 5,
  skillTotalInstalls: 6,
  skillTotalDownloads: 7,
  skillTotalStars: 8,
  deletedAt: null,
  deactivatedAt: null,
  legacyCreatedAt: 10,
  legacyUpdatedAt: 20,
};

const member = {
  legacyConvexId: "publisherMembers:1",
  legacyCreationTime: 2,
  publisherLegacyConvexId: publisher.legacyConvexId,
  memberUserLegacyConvexId: "users:owner",
  role: "owner" as const,
  legacyCreatedAt: 11,
  legacyUpdatedAt: 21,
};

const official = {
  legacyConvexId: "officialPublishers:1",
  legacyCreationTime: 3,
  publisherLegacyConvexId: publisher.legacyConvexId,
  reason: "verified",
  createdByUserLegacyConvexId: "users:reviewer",
  legacyCreatedAt: 12,
  legacyUpdatedAt: 22,
};

type QueryCall = { sql: string; values?: unknown[] };

const createTransactionalPool = (input?: {
  cursor?: string | null;
  completed?: boolean;
  missingProfiles?: Set<string>;
  publisherMapped?: boolean;
  otherRunningBatchId?: string;
}) => {
  let cursor = input?.cursor ?? null;
  let completed = input?.completed ?? false;
  const calls: QueryCall[] = [];
  const committedCalls: QueryCall[] = [];
  const legacyMaps = new Map<string, string>([
    ["profiles:users:owner", "mysql-profile-owner"],
    ["profiles:users:reviewer", "mysql-profile-reviewer"],
  ]);
  if (input?.publisherMapped) {
    legacyMaps.set(`publishers:${publisher.legacyConvexId}`, "mysql-publisher-1");
  }
  let transactionCalls: QueryCall[] | null = null;

  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    const call = { sql, values };
    calls.push(call);
    transactionCalls?.push(call);
    if (sql.includes("SELECT id FROM convex_exit_migration_batches")) {
      return [input?.otherRunningBatchId ? [{ id: input.otherRunningBatchId }] : [], []];
    }
    if (sql.includes("SELECT sourceCursor, status")) {
      return [[{ sourceCursor: cursor, status: completed ? "completed" : "running" }], []];
    }
    if (sql.includes("INNER JOIN profile_snapshots")) {
      const legacyId = String(values?.[0]);
      if (input?.missingProfiles?.has(legacyId)) return [[], []];
      const targetId = legacyMaps.get(`profiles:${legacyId}`);
      return [targetId ? [{ targetId }] : [], []];
    }
    if (sql.includes("INNER JOIN publisher_snapshots")) {
      const targetId = legacyMaps.get(`publishers:${String(values?.[0])}`);
      return [targetId ? [{ targetId }] : [], []];
    }
    if (sql.includes("FROM publisher_snapshots") && sql.includes("handle = ?")) return [[], []];
    if (
      sql.includes("FROM publisher_member_snapshots") ||
      sql.includes("FROM official_publisher_snapshots")
    ) {
      return [[], []];
    }
    if (sql.includes("SELECT targetId FROM convex_exit_legacy_id_maps")) {
      const targetId = legacyMaps.get(`${String(values?.[0])}:${String(values?.[1])}`);
      return [targetId ? [{ targetId }] : [], []];
    }
    if (sql.includes("INSERT INTO convex_exit_legacy_id_maps")) {
      legacyMaps.set(`${String(values?.[0])}:${String(values?.[1])}`, String(values?.[2]));
    }
    if (sql.includes("UPDATE convex_exit_migration_batches") && sql.includes("sourceCursor = ?")) {
      cursor = (values?.[0] as string | null) ?? null;
      completed = Boolean(values?.[6]);
    }
    return [{ affectedRows: 1 }, []];
  });

  const connection = {
    query,
    beginTransaction: vi.fn(async () => {
      transactionCalls = [];
    }),
    commit: vi.fn(async () => {
      committedCalls.push(...(transactionCalls ?? []));
      transactionCalls = null;
    }),
    rollback: vi.fn(async () => {
      transactionCalls = null;
    }),
    release: vi.fn(),
  };
  return {
    pool: { query, getConnection: vi.fn(async () => connection) },
    connection,
    calls,
    committedCalls,
    state: () => ({ cursor, completed }),
  };
};

const sourceFor = () => ({
  listPublishers: vi.fn(async () => ({ items: [publisher], cursor: null, done: true })),
  listMembers: vi.fn(async () => ({ items: [member], cursor: null, done: true })),
  listOfficialPublishers: vi.fn(async () => ({ items: [official], cursor: null, done: true })),
});

describe("Publisher sync orchestrator", () => {
  it("commits Publisher, member, official, avatar outbox and final tombstones by phased pages", async () => {
    const database = createTransactionalPool();
    const source = sourceFor();

    await expect(
      runPublisherSyncToCompletion({
        pool: database.pool as never,
        source,
        batchId: "batch-1",
        batchSize: 10,
        now: () => 1_000,
      }),
    ).resolves.toEqual({ batchId: "batch-1", upserted: 3, unchanged: 0, done: true });

    expect(source.listPublishers).toHaveBeenCalledWith({ cursor: null, limit: 10 });
    expect(source.listMembers).toHaveBeenCalledWith({ cursor: null, limit: 10 });
    expect(source.listOfficialPublishers).toHaveBeenCalledWith({ cursor: null, limit: 10 });
    expect(database.connection.commit).toHaveBeenCalledTimes(3);
    expect(database.connection.rollback).not.toHaveBeenCalled();
    expect(database.state().completed).toBe(true);
    expect(
      database.committedCalls.some(
        ({ sql, values }) =>
          sql.includes("INSERT INTO convex_exit_outbox_events") &&
          values?.includes("publisher-avatar:storage:acme:20"),
      ),
    ).toBe(true);
    expect(
      database.committedCalls.some(({ sql }) =>
        sql.includes("DELETE FROM publisher_member_snapshots WHERE lastSeenBatchId <> ?"),
      ),
    ).toBe(true);
    expect(
      database.committedCalls.some(({ sql }) =>
        sql.includes("SET sourceMissingAt = COALESCE(sourceMissingAt"),
      ),
    ).toBe(true);
  });

  it("resumes the exact phase and source cursor from the generic batch cursor", async () => {
    const cursor = encodePublisherSyncCursor({
      version: 1,
      mode: "full",
      phase: "members",
      sourceCursor: "member-page-2",
      watermark: 900,
    });
    const database = createTransactionalPool({ cursor, publisherMapped: true });
    const source = sourceFor();

    await runPublisherSyncPage({
      pool: database.pool as never,
      source,
      batchId: "batch-resume",
      batchSize: 25,
      now: () => 1_000,
    });

    expect(source.listPublishers).not.toHaveBeenCalled();
    expect(source.listMembers).toHaveBeenCalledWith({ cursor: "member-page-2", limit: 25 });
    expect(source.listOfficialPublishers).not.toHaveBeenCalled();
    expect(database.state().cursor).toContain('"phase":"official"');
  });

  it("fails closed and rolls back the page when a required Profile legacy map is missing", async () => {
    const personalPublisher = {
      ...publisher,
      legacyConvexId: "publishers:user-1",
      kind: "user" as const,
      handle: "alice",
      imageStorageId: null,
      linkedUserLegacyConvexId: "users:missing",
    };
    const database = createTransactionalPool({ missingProfiles: new Set(["users:missing"]) });
    const source = {
      ...sourceFor(),
      listPublishers: vi.fn(async () => ({
        items: [personalPublisher],
        cursor: "next",
        done: false,
      })),
    };

    await expect(
      runPublisherSyncPage({
        pool: database.pool as never,
        source,
        batchId: "batch-missing-profile",
        batchSize: 10,
        now: () => 1_000,
      }),
    ).rejects.toThrow("Missing Profile legacy map for Publisher linked user: users:missing");

    expect(database.connection.rollback).toHaveBeenCalledTimes(1);
    expect(database.connection.commit).not.toHaveBeenCalled();
    expect(database.state().cursor).toBeNull();
    expect(database.calls.some(({ sql }) => sql.includes("SET status = 'failed'"))).toBe(true);
  });

  it("does not query Convex or reopen a completed batch", async () => {
    const database = createTransactionalPool({ completed: true });
    const source = sourceFor();

    await expect(
      runPublisherSyncPage({
        pool: database.pool as never,
        source,
        batchId: "batch-completed",
        batchSize: 10,
      }),
    ).resolves.toMatchObject({ done: true, upserted: 0, unchanged: 0 });
    expect(source.listPublishers).not.toHaveBeenCalled();
    expect(source.listMembers).not.toHaveBeenCalled();
    expect(source.listOfficialPublishers).not.toHaveBeenCalled();
  });

  it("fails closed before reading Convex when another full Publisher batch is running", async () => {
    const database = createTransactionalPool({ otherRunningBatchId: "batch-other" });
    const source = sourceFor();

    await expect(
      runPublisherSyncPage({
        pool: database.pool as never,
        source,
        batchId: "batch-current",
        batchSize: 10,
      }),
    ).rejects.toThrow("Another Publisher migration batch is already running: batch-other");
    expect(source.listPublishers).not.toHaveBeenCalled();
    expect(database.calls.some(({ sql }) => sql.includes("SET status = 'failed'"))).toBe(true);
  });

  it("rejects an incomplete source page that cannot be resumed", async () => {
    const database = createTransactionalPool();
    const source = {
      ...sourceFor(),
      listPublishers: vi.fn(async () => ({ items: [], cursor: null, done: false })),
    };

    await expect(
      runPublisherSyncPage({
        pool: database.pool as never,
        source,
        batchId: "batch-invalid-page",
        batchSize: 10,
      }),
    ).rejects.toThrow("incomplete page without a cursor");
    expect(database.connection.commit).not.toHaveBeenCalled();
  });
});
