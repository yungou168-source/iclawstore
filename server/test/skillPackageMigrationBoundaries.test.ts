import { describe, expect, it } from 'vitest';
import { consumeSkillPackageAssetCopy } from '../src/domains/skill-packages/skillPackageAssetCopyConsumer.js';
import { readWithConvexAuthority } from '../src/domains/skill-packages/skillPackageCompatibilityPort.js';
import { importSkillPackagePage } from '../src/domains/skill-packages/skillPackageImportRunner.js';
import { requireSkillPackageMigrationAuthorization } from '../src/domains/skill-packages/skillPackageMigrationRuntime.js';

const aggregate = {
  domain: 'skill' as const,
  legacyConvexId: 'skills:one',
  ownerPublisherLegacyConvexId: null,
  canonicalName: 'example',
  displayName: 'Example',
  summary: null,
  visibility: 'public' as const,
  metadata: {},
  legacyUpdatedAt: 1,
  sourceHash: 'a'.repeat(64),
  versions: [],
};

describe('skill package candidate migration boundaries', () => {
  it('requires candidate execution approval', () => {
    expect(() => requireSkillPackageMigrationAuthorization({})).toThrow(/EXECUTION/);
    expect(requireSkillPackageMigrationAuthorization({
      SKILL_PACKAGE_MIGRATION_EXECUTION: '1',
      SKILL_PACKAGE_MIGRATION_ENV: 'candidate',
      SKILL_PACKAGE_MIGRATION_APPROVAL_REF: 'approval-1',
    } as NodeJS.ProcessEnv)).toMatchObject({ environment: 'candidate' });
  });

  it('imports one source page through one target boundary', async () => {
    const result = await importSkillPackagePage({
      batchId: 'batch-1', domain: 'skill', cursor: null, batchSize: 1,
      source: { listAggregates: async () => ({ items: [aggregate], cursor: null, done: true }) },
      target: { importPage: async (page) => ({ upsertedCount: page.items.length, unchangedCount: 0 }), listAggregates: async () => ({ items: [], cursor: null, done: true }) },
    });
    expect(result).toMatchObject({ sourceCount: 1, upsertedCount: 1, done: true });
  });

  it('does not allow an expired asset claim to overwrite the task', async () => {
    const result = await consumeSkillPackageAssetCopy({
      queue: {
        claim: async () => ({ id: 'job-1', claimToken: 'old', domain: 'skill', versionLegacyConvexId: 'versions:one', sourceVerified: true, artifact: { legacyStorageId: 'storage:one', path: 'a', mimeType: 'text/plain', sizeBytes: 1, sha256: 'b'.repeat(64) } }),
        complete: async () => false,
        fail: async () => false,
      },
      copier: { copy: async () => ({ status: 'copied', targetAssetId: 'asset-1', failureCode: null }) },
    });
    expect(result).toEqual({ kind: 'lost', id: 'job-1' });
  });

  it('returns Convex output in compare mode', async () => {
    expect(await readWithConvexAuthority({
      operation: 'package.resolve',
      port: { readConvex: async () => 'convex', inspectCandidate: async () => 'candidate', recordDifference: async () => undefined },
    })).toBe('convex');
  });
});