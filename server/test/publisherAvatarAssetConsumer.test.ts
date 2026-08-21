import { describe, expect, it, vi } from "bun:test";
import { createPublisherAvatarAssetConsumer } from "../src/domains/publishers/publisherAvatarAssetConsumer.js";

const eventRow = {
  id: "event-1",
  aggregateId: "publishers:org",
  payload: {
    legacyConvexId: "publishers:org",
    sourceStorageId: "storage:org-avatar",
    publisherId: "publisher-1",
  },
  attempts: 0,
};

const connection = (selectRows: unknown[] = []) => ({
  beginTransaction: vi.fn(async () => undefined),
  commit: vi.fn(async () => undefined),
  rollback: vi.fn(async () => undefined),
  release: vi.fn(),
  query: vi.fn(async (sql: string) =>
    sql.includes("SELECT id, aggregateId") ? [selectRows, []] : [{ affectedRows: 1 }, []],
  ),
});

describe("Publisher avatar asset consumer", () => {
  it("claims, imports, and publishes only an active organization avatar", async () => {
    const claimConnection = connection([eventRow]);
    const publishConnection = connection();
    const pool = {
      getConnection: vi
        .fn()
        .mockResolvedValueOnce(claimConnection)
        .mockResolvedValueOnce(publishConnection),
      query: vi.fn(),
    };
    const source = {
      legacyStorageId: "storage:org-avatar",
      originalFileName: "publisher-avatar.png",
      declaredMimeType: "image/png",
      stream: {} as never,
    };
    const sourceReader = { read: vi.fn(async () => source) };
    const asset = {
      assetId: "asset-1",
      legacyStorageId: "storage:org-avatar",
      ownerLegacyConvexId: "publishers:org",
      accessScope: "public" as const,
      storageKey: "avatar/aa/00000000-0000-0000-0000-000000000000.png",
      originalFileName: "publisher-avatar.png",
      mimeType: "image/png",
      sizeBytes: 4,
      sha256: "a".repeat(64),
      status: "active" as const,
    };
    const importer = { import: vi.fn(async () => asset) };
    const consumer = createPublisherAvatarAssetConsumer({
      pool: pool as never,
      sourceReader,
      importer,
    });

    await expect(consumer.consumeNext()).resolves.toEqual({
      kind: "imported",
      eventId: "event-1",
      assetId: "asset-1",
    });
    expect(importer.import).toHaveBeenCalledWith({
      ownerLegacyConvexId: "publishers:org",
      source,
    });
    expect(
      publishConnection.query.mock.calls.some(([sql]) =>
        String(sql).includes("publisher.kind = 'org'"),
      ),
    ).toBe(true);
  });

  it("retries missing source assets and keeps Publisher state isolated", async () => {
    const claimConnection = connection([eventRow]);
    const pool = {
      getConnection: vi.fn(async () => claimConnection),
      query: vi.fn(async () => [{ affectedRows: 1 }, []]),
    };
    const consumer = createPublisherAvatarAssetConsumer({
      pool: pool as never,
      sourceReader: { read: vi.fn(async () => null) },
      importer: { import: vi.fn() },
    });

    await expect(consumer.consumeNext()).resolves.toMatchObject({
      kind: "failed",
      eventId: "event-1",
      terminal: false,
      failureCode: "publisher_avatar_source_missing",
    });
    expect(
      pool.query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE publisher_avatar_snapshots"),
      ),
    ).toBe(true);
    expect(
      pool.query.mock.calls.some(([sql]) => String(sql).includes("profile_asset_snapshots")),
    ).toBe(false);
  });

  it("rejects aggregate mismatches before reading or importing bytes", async () => {
    const claimConnection = connection([{ ...eventRow, aggregateId: "publishers:other" }]);
    const pool = {
      getConnection: vi.fn(async () => claimConnection),
      query: vi.fn(async () => [{ affectedRows: 1 }, []]),
    };
    const sourceReader = { read: vi.fn() };
    const importer = { import: vi.fn() };
    const consumer = createPublisherAvatarAssetConsumer({
      pool: pool as never,
      sourceReader,
      importer,
    });

    await expect(consumer.consumeNext()).resolves.toMatchObject({
      kind: "failed",
      failureCode: "publisher_avatar_aggregate_mismatch",
    });
    expect(sourceReader.read).not.toHaveBeenCalled();
    expect(importer.import).not.toHaveBeenCalled();
  });
});
