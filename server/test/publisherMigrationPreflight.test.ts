import { describe, expect, it, vi } from "bun:test";
import {
  inspectPublisherMigrationReadiness,
  requirePublisherMigrationAuthorization,
} from "../src/domains/publishers/publisherMigrationPreflight.js";

const tables = [
  "profile_snapshots",
  "publisher_snapshots",
  "publisher_member_snapshots",
  "official_publisher_snapshots",
  "publisher_sync_checkpoints",
  "publisher_avatar_snapshots",
  "convex_exit_migration_batches",
  "convex_exit_legacy_id_maps",
  "convex_exit_reconciliation_records",
  "convex_exit_managed_assets",
  "convex_exit_outbox_events",
  "candidate_fixture_retention_records",
].map((name) => ({ name }));

const constraints = [
  [
    "publisher_snapshots_linked_profile_fk",
    "publisher_snapshots",
    "linkedProfileId",
    "profile_snapshots",
    "id",
    "SET NULL",
  ],
  [
    "publisher_member_snapshots_publisher_fk",
    "publisher_member_snapshots",
    "publisherId",
    "publisher_snapshots",
    "id",
    "CASCADE",
  ],
  [
    "publisher_member_snapshots_profile_fk",
    "publisher_member_snapshots",
    "memberProfileId",
    "profile_snapshots",
    "id",
    "RESTRICT",
  ],
  [
    "official_publisher_snapshots_publisher_fk",
    "official_publisher_snapshots",
    "publisherId",
    "publisher_snapshots",
    "id",
    "CASCADE",
  ],
  [
    "official_publisher_snapshots_created_by_profile_fk",
    "official_publisher_snapshots",
    "createdByProfileId",
    "profile_snapshots",
    "id",
    "SET NULL",
  ],
  [
    "publisher_sync_checkpoints_batch_fk",
    "publisher_sync_checkpoints",
    "batchId",
    "convex_exit_migration_batches",
    "id",
    "CASCADE",
  ],
  [
    "publisher_avatar_snapshots_publisher_fk",
    "publisher_avatar_snapshots",
    "publisherId",
    "publisher_snapshots",
    "id",
    "CASCADE",
  ],
  [
    "publisher_avatar_snapshots_target_asset_fk",
    "publisher_avatar_snapshots",
    "targetAssetId",
    "convex_exit_managed_assets",
    "id",
    "SET NULL",
  ],
].map(([name, tableName, columnName, referencedTableName, referencedColumnName, deleteRule]) => ({
  name,
  tableName,
  columnName,
  referencedTableName,
  referencedColumnName,
  deleteRule,
}));

const database = (
  overrides: Readonly<{
    tables?: unknown[];
    constraints?: unknown[];
    batches?: unknown[];
    missingProfiles?: number;
    pending?: number;
    failed?: number;
    unresolved?: number;
    unclassified?: number;
  }> = {},
) => {
  const query = vi.fn(async (sql: string) => {
    expect(sql.trimStart().startsWith("SELECT")).toBe(true);
    if (sql.includes("information_schema.TABLES")) return [overrides.tables ?? tables, []];
    if (sql.includes("REFERENTIAL_CONSTRAINTS")) return [overrides.constraints ?? constraints, []];
    if (sql.includes("convex_exit_migration_batches")) return [overrides.batches ?? [], []];
    if (sql.includes("linkedProfileId IS NULL"))
      return [[{ count: overrides.missingProfiles ?? 0 }], []];
    if (sql.includes("status IN ('pending', 'processing', 'external')")) {
      return [[{ count: overrides.pending ?? 0 }], []];
    }
    if (sql.includes("status = 'failed'")) return [[{ count: overrides.failed ?? 0 }], []];
    if (sql.includes("classification = 'unclassified'")) {
      return [[{ count: overrides.unclassified ?? 0 }], []];
    }
    if (sql.includes("convex_exit_reconciliation_records")) {
      return [[{ count: overrides.unresolved ?? 0 }], []];
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  return { query };
};

describe("Publisher migration preflight", () => {
  it("requires explicit execution and a separately approved production target", () => {
    expect(() => requirePublisherMigrationAuthorization({})).toThrow(
      "PUBLISHER_MIGRATION_EXECUTION=1 is required",
    );
    expect(() =>
      requirePublisherMigrationAuthorization({
        PUBLISHER_MIGRATION_EXECUTION: "1",
        PUBLISHER_MIGRATION_ENV: "production",
        PUBLISHER_MIGRATION_APPROVAL_REF: "change-123",
      }),
    ).toThrow("PUBLISHER_MIGRATION_PRODUCTION_APPROVED=1 is required for production");
    expect(
      requirePublisherMigrationAuthorization({
        PUBLISHER_MIGRATION_EXECUTION: "1",
        PUBLISHER_MIGRATION_ENV: "candidate",
        PUBLISHER_MIGRATION_APPROVAL_REF: "change-123",
        NODE_ENV: "production",
      }),
    ).toEqual({ environment: "candidate", approvalRef: "change-123" });
  });

  it("fails structural readiness when a required table or relation is missing", async () => {
    const missingTable = await inspectPublisherMigrationReadiness(
      database({ tables: tables.filter(({ name }) => name !== "convex_exit_outbox_events") }) as never,
    );
    expect(missingTable.ready).toBe(false);
    expect(missingTable.missingTables).toEqual(["convex_exit_outbox_events"]);

    const invalid = { ...constraints[7], deleteRule: "CASCADE" };
    const invalidRelation = await inspectPublisherMigrationReadiness(
      database({ constraints: [...constraints.slice(0, 7), invalid] }) as never,
    );
    expect(invalidRelation.ready).toBe(false);
    expect(invalidRelation.invalidConstraints).toEqual([
      "publisher_avatar_snapshots_target_asset_fk",
    ]);
  });

  it("keeps structural readiness separate from candidate backlog readiness", async () => {
    const db = database({
      batches: [{ id: "publisher-running" }],
      missingProfiles: 1,
      pending: 2,
      failed: 1,
      unresolved: 4,
      unclassified: 3,
    });
    const report = await inspectPublisherMigrationReadiness(db as never);
    expect(report).toMatchObject({
      ready: true,
      candidateReady: false,
      missingProfileLinks: 1,
      runningBatchIds: ["publisher-running"],
      pendingAssets: 2,
      failedAssets: 1,
      unresolvedDifferences: 4,
      unclassifiedDifferences: 3,
    });
  });
});
