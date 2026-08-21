import { describe, expect, it, vi } from "bun:test";
import { createComparePublicProfileAdapter } from "../src/domains/profiles/comparePublicProfileAdapter.js";
import { createMysqlProfileDifferenceSink } from "../src/domains/profiles/comparePublicProfileAdapter.js";
import { createMysqlPublicProfileAdapter } from "../src/domains/profiles/mysqlPublicProfileAdapter.js";
import { profileReadModeFromEnvironment } from "../src/domains/profiles/profilePortFactory.js";
import { createProfileReadObserver } from "../src/domains/profiles/profileReadObservability.js";

const profile = {
  user: { _id: "users:1", _creationTime: 1, handle: "alice", displayName: "Alice" },
  profileSlug: "alice",
  publisher: null,
} as const;

describe("profile domain adapters", () => {
  it("returns Convex data when comparison reports differences", async () => {
    const convex = { getBySlug: vi.fn(async () => profile) };
    const mysql = { getBySlug: vi.fn(async () => null) };
    const sink = { record: vi.fn(async () => undefined) };
    const adapter = createComparePublicProfileAdapter(convex, mysql, sink);
    await expect(adapter.getBySlug("alice")).resolves.toEqual(profile);
    expect(sink.record).toHaveBeenCalledWith([
      expect.objectContaining({
        stableId: "users:1",
        fieldName: "profile",
        differenceKind: "missing",
      }),
    ]);
  });

  it("returns Convex data when MySQL comparison fails", async () => {
    const convex = { getBySlug: vi.fn(async () => profile) };
    const mysql = {
      getBySlug: vi.fn(async () => {
        throw new Error("unavailable");
      }),
    };
    const sink = { record: vi.fn(async () => undefined) };
    const warn = vi.fn();
    const adapter = createComparePublicProfileAdapter(convex, mysql, sink, { warn });
    await expect(adapter.getBySlug("alice")).resolves.toEqual(profile);
    expect(warn).toHaveBeenCalled();
  });

  it("tracks compare hits, differences, and adapter errors without changing the Convex result", async () => {
    const observer = createProfileReadObserver();
    const convex = { getBySlug: vi.fn(async () => profile) };
    const mysql = {
      getBySlug: vi
        .fn()
        .mockResolvedValueOnce({ ...profile, user: { ...profile.user, displayName: "Other" } })
        .mockRejectedValueOnce(new Error("timeout")),
    };
    const sink = { record: vi.fn(async () => undefined) };
    const adapter = createComparePublicProfileAdapter(
      convex,
      mysql,
      sink,
      { warn: vi.fn() },
      observer,
    );

    await expect(adapter.getBySlug("alice")).resolves.toBe(profile);
    await expect(adapter.getBySlug("alice")).resolves.toBe(profile);
    expect(observer.snapshot()).toEqual({ mysqlHit: 1, fallback: 0, diff: 1, adapterError: 1 });
  });

  it.each([
    {
      name: "normal user",
      row: {
        legacyConvexId: "users:1",
        handle: "alice",
        profileSlug: "alice",
        name: "Alice",
        displayName: "Alice Example",
        bio: "hello",
        targetAssetId: "asset-1",
        legacyCreationTime: 1,
      },
      expected: {
        user: {
          _id: "users:1",
          _creationTime: 1,
          handle: "alice",
          name: "Alice",
          displayName: "Alice Example",
          bio: "hello",
          image: "/api/profile-assets/asset-1/content",
        },
        profileSlug: "alice",
        publisher: null,
      },
    },
    {
      name: "user without avatar",
      row: {
        legacyConvexId: "users:1",
        handle: "alice",
        profileSlug: "alice",
        name: null,
        displayName: "Alice",
        bio: null,
        targetAssetId: null,
        legacyCreationTime: 1,
      },
      expected: profile,
    },
    {
      name: "handle fallback",
      row: {
        legacyConvexId: "users:1",
        handle: "alice",
        profileSlug: null,
        name: null,
        displayName: "Alice",
        bio: null,
        targetAssetId: null,
        legacyCreationTime: 1,
      },
      expected: profile,
    },
  ])("maps $name using the public Convex response shape", async ({ row, expected }) => {
    const query = vi.fn(async () => [[row], []]);
    const adapter = createMysqlPublicProfileAdapter({ query } as never);
    await expect(adapter.getBySlug(" ALICE ")).resolves.toEqual(expected);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("p.deletedAt IS NULL"), [
      "alice",
      "alice",
      "alice",
      "alice",
    ]);
    expect(query.mock.calls[0]?.[0]).toContain("deactivatedAt IS NULL");
  });

  it.each(["deleted", "deactivated", "banned"])(
    "returns null when a $name snapshot is hidden",
    async () => {
      const query = vi.fn(async () => [[], []]);
      const adapter = createMysqlPublicProfileAdapter({ query } as never);
      await expect(adapter.getBySlug("alice")).resolves.toBeNull();
      const sql = String(query.mock.calls[0]?.[0]);
      expect(sql).toContain("deletedAt IS NULL");
      expect(sql).toContain("deactivatedAt IS NULL");
    },
  );

  it("returns null for an unknown or blank slug", async () => {
    const query = vi.fn(async () => [[], []]);
    const adapter = createMysqlPublicProfileAdapter({ query } as never);
    await expect(adapter.getBySlug("missing")).resolves.toBeNull();
    await expect(adapter.getBySlug("   ")).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("updates a stable reconciliation record key for repeated differences", async () => {
    const query = vi.fn(async () => [{ affectedRows: 1 }, []]);
    const sink = createMysqlProfileDifferenceSink({ query } as never);
    const difference = {
      stableId: "users:1",
      fieldName: "profileSlug",
      differenceKind: "value_mismatch" as const,
      summary: "different",
    };
    await sink.record([difference]);
    await sink.record([{ ...difference, summary: "still different" }]);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[1]?.[0]).toBe(query.mock.calls[1]?.[1]?.[0]);
    expect(query.mock.calls[0]?.[0]).toContain("ON DUPLICATE KEY UPDATE");
  });

  it("uses only MySQL authoritative profile reads", () => {
    expect(profileReadModeFromEnvironment({})).toBe("mysql_authoritative");
    expect(profileReadModeFromEnvironment({ PROFILE_READ_MODE: "convex" })).toBe("mysql_authoritative");
  });
});
