import { describe, expect, it, vi } from "bun:test";
import {
  assertPublisherCandidateUrlIsNonProduction,
  inspectPublisherCutoverReadiness,
} from "../src/domains/publishers/publisherCutoverReadiness.js";

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

const database = (overrides: { pending?: number; unresolved?: number } = {}) => ({
  query: vi.fn(async (sql: string) => {
    if (sql.includes("information_schema.TABLES")) return [tables, []];
    if (sql.includes("REFERENTIAL_CONSTRAINTS")) return [constraints, []];
    if (sql.includes("convex_exit_migration_batches")) return [[], []];
    if (sql.includes("linkedProfileId IS NULL")) return [[{ count: 0 }], []];
    if (sql.includes("status IN ('pending', 'processing', 'external')")) {
      return [[{ count: overrides.pending ?? 0 }], []];
    }
    if (sql.includes("status = 'failed'")) return [[{ count: 0 }], []];
    if (sql.includes("classification = 'unclassified'")) return [[{ count: 0 }], []];
    if (sql.includes("convex_exit_reconciliation_records")) {
      return [[{ count: overrides.unresolved ?? 0 }], []];
    }
    throw new Error(`Unexpected query: ${sql}`);
  }),
});

describe("Publisher cutover readiness", () => {
  it("requires an explicit non-production candidate URL", () => {
    expect(() => assertPublisherCandidateUrlIsNonProduction({})).toThrow(
      "PUBLISHER_PUBLIC_READ_CANDIDATE_URL is required",
    );
    expect(() =>
      assertPublisherCandidateUrlIsNonProduction({
        PUBLISHER_PUBLIC_READ_CANDIDATE_URL: "https://iclawstore.com",
        PRODUCTION_PUBLIC_URL: "https://iclawstore.com/",
      }),
    ).toThrow("PUBLISHER_PUBLIC_READ_CANDIDATE_URL must not match a production URL");
    expect(() =>
      assertPublisherCandidateUrlIsNonProduction({
        PUBLISHER_PUBLIC_READ_CANDIDATE_URL: "https://iclawstore.com",
        PUBLISHER_PUBLIC_READ_ALLOW_PRODUCTION_CANDIDATE: "1",
      }),
    ).toThrow("Production candidate override is intentionally unsupported");
    expect(
      assertPublisherCandidateUrlIsNonProduction({
        PUBLISHER_PUBLIC_READ_CANDIDATE_URL: "https://publisher-candidate.internal.example",
        PRODUCTION_PUBLIC_URL: "https://iclawstore.com",
      }),
    ).toBe("https://publisher-candidate.internal.example");
  });

  it("reports readiness blocks but never performs cutover", async () => {
    const report = await inspectPublisherCutoverReadiness(database({ pending: 2 }) as never, {
      PUBLISHER_PUBLIC_READ_CANDIDATE_URL: "https://publisher-candidate.internal.example",
      PRODUCTION_PUBLIC_URL: "https://iclawstore.com",
    });
    expect(report.ready).toBe(false);
    expect(report.blocks).toContain("publisher_candidate_backlog_not_ready");
    expect(report.blocks).toContain("publisher_assets_pending");
    expect(report.candidateUrl).toBe("https://publisher-candidate.internal.example");
  });
});
