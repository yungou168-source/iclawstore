import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SoulSnapshot } from '../src/domains/souls/soulMigrationDto.js';
import { normalizeSoulSnapshot } from '../src/domains/souls/soulNormalizer.js';
import { reconcileSoulSnapshots } from '../src/domains/souls/soulReconciliation.js';

const migration = readFileSync(
  resolve(import.meta.dirname, '../../prisma/migrations/20260906_soul_migration_foundation/migration.sql'),
  'utf8',
);

const soul = (): SoulSnapshot => ({
  legacyConvexId: 'souls:1',
  slug: '  Lorekeeper ',
  displayName: ' Lorekeeper ',
  summary: ' A remembered guide ',
  ownerUserLegacyConvexId: 'users:1',
  ownerPublisherLegacyConvexId: 'publishers:1',
  latestVersionLegacyConvexId: 'soulVersions:1',
  tags: { latest: 'soulVersions:1' },
  stats: { downloads: 2, stars: 1, versions: 1, comments: 0 },
  legacyCreatedAt: 1,
  legacyUpdatedAt: 2,
  softDeletedAt: null,
  sourceHash: 'A'.repeat(64),
  versions: [{
    legacyConvexId: 'soulVersions:1',
    semanticVersion: ' 1.0.0 ',
    fingerprint: 'B'.repeat(64),
    changelog: ' Initial release ',
    changelogSource: 'USER ',
    parsedMetadata: { source: { commit: 'abc', repo: 'owner/repo' } },
    createdByUserLegacyConvexId: 'users:1',
    legacyCreatedAt: 1,
    softDeletedAt: null,
    sourceHash: 'C'.repeat(64),
    files: [{
      path: 'docs\\SOUL.md',
      sizeBytes: 12,
      mimeType: 'TEXT/MARKDOWN',
      sha256: 'D'.repeat(64),
      legacyStorageId: 'storage:1',
      targetAssetId: null,
      assetReferenceState: 'pending',
    }],
  }],
});

describe('Soul candidate migration foundation', () => {
  it('normalizes only representational differences deterministically', () => {
    const normalized = normalizeSoulSnapshot(soul());

    expect(normalized.slug).toBe('lorekeeper');
    expect(normalized.displayName).toBe('Lorekeeper');
    expect(normalized.sourceHash).toBe('a'.repeat(64));
    expect(normalized.versions[0]).toMatchObject({
      semanticVersion: '1.0.0',
      fingerprint: 'b'.repeat(64),
      changelogSource: 'user',
      sourceHash: 'c'.repeat(64),
      files: [expect.objectContaining({ path: 'docs/SOUL.md', mimeType: 'text/markdown', sha256: 'd'.repeat(64) })],
    });
  });

  it('does not report normalized ordering and formatting differences', () => {
    const source = soul();
    const target = normalizeSoulSnapshot(source);

    expect(reconcileSoulSnapshots({ source: [source], target: [target] })).toEqual([]);
  });

  it('reports owner, file asset-state, missing, and orphan discrepancies', () => {
    const source = normalizeSoulSnapshot(soul());
    const target: SoulSnapshot = {
      ...source,
      ownerPublisherLegacyConvexId: 'publishers:2',
      versions: [{
        ...source.versions[0],
        files: [{ ...source.versions[0].files[0], assetReferenceState: 'failed' }],
      }, {
        ...source.versions[0],
        legacyConvexId: 'soulVersions:orphan',
        semanticVersion: '2.0.0',
      }],
    };

    expect(reconcileSoulSnapshots({ source: [source], target: [target] })).toEqual([
      { legacyConvexId: 'souls:1', fieldName: 'owner', differenceKind: 'value_mismatch', summary: 'owner or publisher differs' },
      { legacyConvexId: 'soulVersions:1', fieldName: 'file', differenceKind: 'value_mismatch', summary: 'file docs/SOUL.md differs or is absent' },
      { legacyConvexId: 'soulVersions:orphan', fieldName: 'version', differenceKind: 'orphan', summary: 'target-only version is orphaned' },
    ]);
  });

  it('is expand-only and preserves the candidate snapshot state', () => {
    const tables = [...migration.matchAll(/CREATE TABLE IF NOT EXISTS `([^`]+)`/g)].map((match) => match[1]);
    expect(tables).toEqual(['soul_snapshots', 'soul_version_snapshots', 'soul_version_file_snapshots']);
    expect(migration).toContain('`legacyConvexId` VARCHAR(191) NOT NULL');
    expect(migration).toContain('`softDeletedAt` DATETIME(3) NULL');
    expect(migration).toContain('`ownerPublisherLegacyConvexId` VARCHAR(191) NULL');
    expect(migration).toContain('`assetReferenceState` VARCHAR(32) NOT NULL DEFAULT \'pending\'');
    expect(migration).toContain('`sha256` CHAR(64) NOT NULL');

    const statements = migration.replace(/^--.*$/gm, '').split(';').map((statement) => statement.trim()).filter(Boolean);
    expect(statements).toHaveLength(3);
    for (const statement of statements) {
      expect(statement).not.toMatch(/^(?:ALTER|DROP|DELETE|TRUNCATE|RENAME|UPDATE)\b/i);
    }
  });
});