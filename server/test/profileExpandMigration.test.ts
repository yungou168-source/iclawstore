import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  import.meta.dir,
  "../../prisma/migrations/20260820_profile_domain_expand/migration.sql",
);
const migration = readFileSync(migrationPath, "utf8");

describe("profile domain expand migration", () => {
  it("creates only the reviewed profile projection tables", () => {
    const tables = [...migration.matchAll(/CREATE TABLE `([^`]+)`/g)].map((match) => match[1]);
    expect(tables).toEqual([
      "profile_snapshots",
      "profile_legacy_id_maps",
      "profile_migration_batches",
      "profile_migration_cursors",
      "profile_reconciliation_records",
    ]);
  });

  it("contains no destructive or existing-table mutation statements", () => {
    const statements = migration
      .replace(/^--.*$/gm, "")
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);
    expect(statements).toHaveLength(5);
    for (const statement of statements) {
      expect(statement).not.toMatch(/^(?:ALTER|DROP|DELETE|TRUNCATE|RENAME|UPDATE)\b/i);
      expect(statement).not.toMatch(
        /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:VIEW|TRIGGER|PROCEDURE|FUNCTION)\b/i,
      );
    }
  });

  it("enforces one-to-one legacy ID mapping at the database boundary", () => {
    expect(migration).toContain("PRIMARY KEY (`legacyConvexId`)");
    expect(migration).toContain(
      "UNIQUE KEY `profile_legacy_id_maps_mysql_profile_id_key` (`mysqlProfileId`)",
    );
    expect(migration).toContain(
      "FOREIGN KEY (`mysqlProfileId`) REFERENCES `profile_snapshots` (`id`) ON DELETE CASCADE",
    );
  });
});
