import { describe, expect, it } from 'vitest';
import { consumeSkillPackageAssetCopy, type SkillPackageAssetCopyJob, type SkillPackageAssetCopyQueue } from '../src/domains/skill-packages/skillPackageAssetCopyConsumer.js';
import type { ArtifactCopyPort } from '../src/domains/skill-packages/skillPackageMigrationPort.js';

const job: SkillPackageAssetCopyJob = {
  id: 'job-1', claimToken: 'claim-1', domain: 'skill', versionLegacyConvexId: 'version-1', sourceVerified: true,
  artifact: { legacyStorageId: 'storage-1', path: 'skill.zip', mimeType: 'application/zip', sizeBytes: 10, sha256: 'a'.repeat(64) },
};

const queue = (claimed: SkillPackageAssetCopyJob | null, complete = true, fail = true): SkillPackageAssetCopyQueue & { completed: unknown[]; failed: unknown[] } => {
  const completed: unknown[] = [];
  const failed: unknown[] = [];
  return {
    completed, failed,
    async claim() { return claimed; },
    async complete(input) { completed.push(input); return complete; },
    async fail(input) { failed.push(input); return fail; },
  };
};

const copier = (result: Awaited<ReturnType<ArtifactCopyPort['copy']>>): ArtifactCopyPort => ({ async copy() { return result; } });

describe('candidate skill/package asset copy consumer', () => {
  it('remains idle without a claimed job and completes a verified copy exactly once', async () => {
    expect(await consumeSkillPackageAssetCopy({ queue: queue(null), copier: copier({ status: 'copied', targetAssetId: 'asset-1', failureCode: null }) })).toEqual({ kind: 'idle' });
    const claimed = queue(job);
    expect(await consumeSkillPackageAssetCopy({ queue: claimed, copier: copier({ status: 'copied', targetAssetId: 'asset-1', failureCode: null }) })).toEqual({ kind: 'copied', id: 'job-1' });
    expect(claimed.completed).toEqual([{ id: 'job-1', claimToken: 'claim-1', targetAssetId: 'asset-1' }]);
  });

  it('fails unverified or failed copies and rejects stale completion claims', async () => {
    const unverified = queue({ ...job, sourceVerified: false });
    expect(await consumeSkillPackageAssetCopy({ queue: unverified, copier: copier({ status: 'copied', targetAssetId: 'asset-1', failureCode: null }) })).toEqual({ kind: 'failed', id: 'job-1' });
    expect(unverified.failed).toEqual([{ id: 'job-1', claimToken: 'claim-1', failureCode: 'source_snapshot_unverified' }]);

    const failedCopy = queue(job);
    expect(await consumeSkillPackageAssetCopy({ queue: failedCopy, copier: copier({ status: 'failed', targetAssetId: null, failureCode: 'checksum_mismatch' }) })).toEqual({ kind: 'lost', id: 'job-1' });
    expect(failedCopy.failed).toEqual([{ id: 'job-1', claimToken: 'claim-1', failureCode: 'checksum_mismatch' }]);

    const stale = queue(job, false);
    expect(await consumeSkillPackageAssetCopy({ queue: stale, copier: copier({ status: 'copied', targetAssetId: 'asset-1', failureCode: null }) })).toEqual({ kind: 'lost', id: 'job-1' });
  });

  it('records copier exceptions as retryable failures without throwing worker errors', async () => {
    const claimed = queue(job);
    const throwing: ArtifactCopyPort = { async copy() { throw new Error('source unavailable'); } };
    expect(await consumeSkillPackageAssetCopy({ queue: claimed, copier: throwing })).toEqual({ kind: 'failed', id: 'job-1' });
    expect(claimed.failed).toEqual([{ id: 'job-1', claimToken: 'claim-1', failureCode: 'source unavailable' }]);
  });
});