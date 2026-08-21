import { describe, expect, it } from 'vitest';
import type { SkillPackageAggregateSnapshot } from '../src/domains/skill-packages/skillPackageMigrationPort.js';
import { stableSkillPackageAggregate } from '../src/domains/skill-packages/skillPackageNormalizer.js';
import { reconcileSkillPackageAggregates } from '../src/domains/skill-packages/skillPackageReconciliation.js';

const aggregate = (overrides: Partial<SkillPackageAggregateSnapshot> = {}): SkillPackageAggregateSnapshot => ({
  domain: 'package',
  legacyConvexId: 'packages:one',
  ownerPublisherLegacyConvexId: 'publishers:one',
  canonicalName: '@Example/Plugin',
  displayName: ' Example Plugin ',
  summary: ' Example summary ',
  visibility: 'public',
  metadata: { tags: ['example'], family: 'code-plugin' },
  legacyUpdatedAt: 2,
  sourceHash: 'a'.repeat(64),
  versions: [{
    legacyConvexId: 'packageReleases:one',
    semanticVersion: ' 1.0.0 ',
    sourceHash: 'b'.repeat(64),
    sourceMetadata: { source: 'cli' },
    scanSnapshot: { status: 'clean' },
    legacyCreatedAt: 1,
    legacyUpdatedAt: 2,
    artifacts: [{
      legacyStorageId: 'storage:one',
      path: 'dist\\plugin.tgz',
      mimeType: 'Application/Gzip',
      sizeBytes: 12,
      sha256: 'C'.repeat(64),
    }],
  }],
  ...overrides,
});

describe('skillPackage migration DTOs', () => {
  it('normalizes names, metadata and artifact identity deterministically', () => {
    const value = stableSkillPackageAggregate(aggregate());

    expect(value).toContain('"@example/plugin"');
    expect(value).toContain('dist/plugin.tgz');
    expect(value).toContain('application/gzip');
    expect(value).toContain('c'.repeat(64));
  });

  it('ignores object field order while preserving semantic differences', () => {
    const source = aggregate({
      metadata: { family: 'code-plugin', tags: ['example'] },
      versions: [{
        ...aggregate().versions[0],
        sourceMetadata: { source: 'cli', channel: 'stable' },
        scanSnapshot: { findings: [], status: 'clean' },
      }],
    });
    const target = aggregate({
      metadata: { tags: ['example'], family: 'code-plugin' },
      versions: [{
        ...aggregate().versions[0],
        sourceMetadata: { channel: 'stable', source: 'cli' },
        scanSnapshot: { status: 'clean', findings: [] },
      }],
    });

    expect(stableSkillPackageAggregate(source)).toBe(stableSkillPackageAggregate(target));
    expect(reconcileSkillPackageAggregates({ source: [source], target: [target] })).toEqual([]);
  });

  it('reports both source-only and target-only aggregates', () => {
    expect(reconcileSkillPackageAggregates({
      source: [aggregate()],
      target: [aggregate({ legacyConvexId: 'packages:two' })],
    })).toEqual([
      expect.objectContaining({ legacyConvexId: 'packages:one', differenceKind: 'missing' }),
      expect.objectContaining({ legacyConvexId: 'packages:two', differenceKind: 'orphan' }),
    ]);
  });
});