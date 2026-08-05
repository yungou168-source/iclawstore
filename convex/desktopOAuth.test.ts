/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRefreshFamilyAccessInternal,
  recordRefreshFamilyUseInternal,
  revokeRefreshFamiliesForUserInternal,
} from "./desktopOAuth";
import {
  DESKTOP_REFRESH_ABSOLUTE_TTL_MS,
  DESKTOP_REFRESH_IDLE_TTL_MS,
} from "./lib/desktopOAuthTokenPolicy";

type TestHandler<Args, Result> = (ctx: unknown, args: Args) => Promise<Result>;

type TestCallable<Args, Result> = {
  _handler: TestHandler<Args, Result>;
};

function handler<Args, Result>(value: unknown): TestHandler<Args, Result> {
  const callable = value as Partial<TestCallable<Args, Result>>;
  if (typeof callable._handler !== "function") {
    throw new Error("Expected a Convex function with a test-callable _handler");
  }
  return callable._handler;
}

type Family = {
  _id: string;
  familyId: string;
  userId: string;
  clientId: string;
  createdAt: number;
  lastUsedAt: number;
  absoluteExpiresAt: number;
  idleExpiresAt: number;
  revokedAt?: number;
};

function makeCtx(
  options: {
    family?: Family | null;
    revokeRows?: Family[];
    user?: Record<string, unknown> | null;
  } = {},
) {
  const family = options.family ?? null;
  const revokeRows = options.revokeRows ?? [];
  const user =
    options.user === undefined
      ? { _id: "users:1", deletedAt: undefined, deactivatedAt: undefined }
      : options.user;
  const insert = vi.fn(async () => "desktopOAuthTokenFamilies:new");
  const patch = vi.fn(async () => undefined);
  const unique = vi.fn(async () => family);
  const take = vi.fn(async () => revokeRows);
  const query = vi.fn(() => ({
    withIndex: vi.fn(
      (
        _name: string,
        build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
      ) => {
        const q = { eq: vi.fn(() => q) };
        build(q);
        return { unique, take };
      },
    ),
  }));
  const scheduler = { runAfter: vi.fn(async () => undefined) };

  return {
    ctx: {
      db: {
        normalizeId: vi.fn((table: string, id: string) =>
          table === "users" && id.startsWith("users:") ? id : null,
        ),
        get: vi.fn(async (id: string) => (id === "users:1" ? user : null)),
        query,
        insert,
        patch,
        replace: vi.fn(),
        delete: vi.fn(),
        system: {},
      },
      scheduler,
    },
    insert,
    patch,
    scheduler,
  };
}

const recordUse = handler<
  { familyId: string; userId: string; clientId: string; initialIssue: boolean },
  null
>(recordRefreshFamilyUseInternal);
const getAccess = handler<
  { familyId: string; userId: string; clientId: string },
  { active: boolean; reason?: string }
>(getRefreshFamilyAccessInternal);
const revokeFamilies = handler<
  { userId: string; revokedAt?: number },
  { revoked: number; hasMore: boolean }
>(revokeRefreshFamiliesForUserInternal);

describe("desktop OAuth refresh family persistence", () => {
  const now = 1_700_000_000_000;
  const clientId = "desktop-client";
  let previousClientId: string | undefined;

  beforeEach(() => {
    previousClientId = process.env.AI_DIRECT_DESKTOP_OAUTH_CLIENT_ID;
    process.env.AI_DIRECT_DESKTOP_OAUTH_CLIENT_ID = clientId;
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (previousClientId === undefined) {
      delete process.env.AI_DIRECT_DESKTOP_OAUTH_CLIENT_ID;
    } else {
      process.env.AI_DIRECT_DESKTOP_OAUTH_CLIENT_ID = previousClientId;
    }
  });

  it("creates a fixed family policy on the initial authorization-code exchange", async () => {
    const { ctx, insert } = makeCtx();

    await recordUse(ctx, {
      familyId: "family-1",
      userId: "users:1",
      clientId,
      initialIssue: true,
    });

    expect(insert).toHaveBeenCalledWith("desktopOAuthTokenFamilies", {
      familyId: "family-1",
      userId: "users:1",
      clientId,
      createdAt: now,
      lastUsedAt: now,
      absoluteExpiresAt: now + DESKTOP_REFRESH_ABSOLUTE_TTL_MS,
      idleExpiresAt: now + DESKTOP_REFRESH_IDLE_TTL_MS,
    });
  });

  it("advances only the idle deadline after refresh rotation", async () => {
    const family: Family = {
      _id: "desktopOAuthTokenFamilies:1",
      familyId: "family-1",
      userId: "users:1",
      clientId,
      createdAt: now - 1_000,
      lastUsedAt: now - 1_000,
      absoluteExpiresAt: now + DESKTOP_REFRESH_ABSOLUTE_TTL_MS,
      idleExpiresAt: now + 1_000,
    };
    const { ctx, patch, insert } = makeCtx({ family });

    await recordUse(ctx, {
      familyId: family.familyId,
      userId: family.userId,
      clientId,
      initialIssue: false,
    });

    expect(patch).toHaveBeenCalledWith(family._id, {
      lastUsedAt: now,
      idleExpiresAt: now + DESKTOP_REFRESH_IDLE_TTL_MS,
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("fails closed when a refresh family has no policy row", async () => {
    const { ctx } = makeCtx();

    await expect(
      recordUse(ctx, {
        familyId: "missing-family",
        userId: "users:1",
        clientId,
        initialIssue: false,
      }),
    ).rejects.toThrow("Desktop OAuth token family is not registered");

    await expect(
      getAccess(ctx, { familyId: "missing-family", userId: "users:1", clientId }),
    ).resolves.toEqual({ active: false, reason: "family_missing" });
  });

  it("rejects disabled accounts before reading or writing family state", async () => {
    const { ctx, insert, patch } = makeCtx({
      user: { _id: "users:1", deactivatedAt: now, deletedAt: undefined },
    });

    await expect(
      recordUse(ctx, {
        familyId: "family-1",
        userId: "users:1",
        clientId,
        initialIssue: true,
      }),
    ).rejects.toThrow("Desktop OAuth token family user is disabled");
    expect(insert).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("revokes one bounded page and schedules continuation with the same timestamp", async () => {
    const rows = Array.from(
      { length: 100 },
      (_, index): Family => ({
        _id: `desktopOAuthTokenFamilies:${index}`,
        familyId: `family-${index}`,
        userId: "users:1",
        clientId,
        createdAt: now - 1_000,
        lastUsedAt: now - 1_000,
        absoluteExpiresAt: now + 10_000,
        idleExpiresAt: now + 10_000,
      }),
    );
    const { ctx, patch, scheduler } = makeCtx({ revokeRows: rows });

    await expect(revokeFamilies(ctx, { userId: "users:1", revokedAt: now })).resolves.toEqual({
      revoked: 100,
      hasMore: true,
    });
    expect(patch).toHaveBeenCalledTimes(100);
    expect(scheduler.runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      userId: "users:1",
      revokedAt: now,
    });
  });
});
