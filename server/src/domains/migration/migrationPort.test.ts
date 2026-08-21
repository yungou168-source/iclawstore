import { describe, expect, it } from "vitest";
import { createMigrationPort, type MigrationSqlConnection } from "./migrationPort.js";

type QueryCall = Readonly<{ sql: string; values: readonly unknown[] | undefined }>;

const createConnection = (responses: unknown[] = []) => {
  const calls: QueryCall[] = [];
  const connection: MigrationSqlConnection = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      return responses.shift() ?? [[], undefined];
    },
  };
  return { connection, calls };
};

describe("migration port", () => {
  it("preserves batch progress without activating a data path", async () => {
    const { connection, calls } = createConnection();
    const port = createMigrationPort(connection);

    await port.startBatch({
      id: "batch-1",
      domain: "catalog",
      source: "convex-source-page",
      approvalRef: "isolated-only",
    });
    await port.persistProgress("batch-1", {
      cursor: "cursor-2",
      sourceCount: 10n,
      upsertedCount: 4n,
      unchangedCount: 5n,
      errorCount: 1n,
      completed: false,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.sql).toContain("convex_exit_migration_batches");
    expect(calls[0]?.values).toEqual([
      "batch-1",
      "catalog",
      "convex-source-page",
      "isolated-only",
      null,
    ]);
    expect(calls[1]?.values).toEqual(["cursor-2", 10n, 4n, 5n, 1n, false, false, "batch-1"]);
  });

  it("rejects legacy ID remapping conflicts", async () => {
    const { connection } = createConnection([[[{ targetId: "target-a" }], undefined]]);
    const port = createMigrationPort(connection);

    await expect(
      port.ensureLegacyIdMap({
        domain: "profiles",
        legacyConvexId: "users:legacy-1",
        targetId: "target-b",
      }),
    ).rejects.toThrow("Legacy Convex ID maps to a different target ID");
  });

  it("does not mutate a completed batch", async () => {
    const { connection, calls } = createConnection();
    const port = createMigrationPort(connection);

    await port.persistProgress("batch-1", {
      cursor: "cursor-3",
      upsertedCount: 0n,
      unchangedCount: 0n,
      errorCount: 0n,
      completed: false,
    });
    await port.recordFailure("batch-1", "unexpected_retry");

    expect(calls[0]?.sql).toContain("status <> 'completed'");
    expect(calls[1]?.sql).toContain("status <> 'completed'");
  });

  it("deduplicates reconciliation evidence and outbox events by stable keys", async () => {
    const { connection, calls } = createConnection();
    const port = createMigrationPort(connection);

    await port.recordDifference({
      domain: "catalog",
      batchId: "batch-1",
      legacyConvexId: "skills:legacy-1",
      fieldName: "sha256",
      differenceKind: "value_mismatch",
      summary: "asset digest differs",
    });
    await port.publishDomainEvent({
      domain: "catalog",
      aggregateId: "skills:legacy-1",
      aggregateVersion: 2n,
      eventType: "catalog.asset-imported",
      idempotencyKey: "catalog:skills:legacy-1:2",
      payload: { assetId: "asset-1" },
    });

    expect(calls[0]?.sql).toContain("recordKey");
    expect(calls[0]?.values?.[1]).toMatch(/^[a-f0-9]{64}$/);
    expect(calls[1]?.sql).toContain("ON DUPLICATE KEY UPDATE id = id");
    expect(calls[1]?.values?.slice(1)).toEqual([
      "catalog",
      "skills:legacy-1",
      2n,
      "catalog.asset-imported",
      "catalog:skills:legacy-1:2",
      '{"assetId":"asset-1"}',
    ]);
  });
});
