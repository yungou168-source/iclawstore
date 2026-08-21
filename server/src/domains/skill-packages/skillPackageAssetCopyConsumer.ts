import type { ArtifactCopyPort, SkillPackageArtifactSnapshot, SkillPackageDomain } from './skillPackageMigrationPort.js';

export type SkillPackageAssetCopyJob = Readonly<{
  id: string;
  claimToken: string;
  domain: SkillPackageDomain;
  versionLegacyConvexId: string;
  artifact: SkillPackageArtifactSnapshot;
  sourceVerified: boolean;
}>;

export type SkillPackageAssetCopyQueue = Readonly<{
  claim: () => Promise<SkillPackageAssetCopyJob | null>;
  complete: (input: Readonly<{ id: string; claimToken: string; targetAssetId: string }>) => Promise<boolean>;
  fail: (input: Readonly<{ id: string; claimToken: string; failureCode: string }>) => Promise<boolean>;
}>;

export const consumeSkillPackageAssetCopy = async (input: Readonly<{
  queue: SkillPackageAssetCopyQueue;
  copier: ArtifactCopyPort;
}>) => {
  const job = await input.queue.claim();
  if (!job) return Object.freeze({ kind: 'idle' as const });
  if (!job.sourceVerified || !job.artifact.legacyStorageId) {
    const persisted = await input.queue.fail({ id: job.id, claimToken: job.claimToken, failureCode: 'source_snapshot_unverified' });
    return Object.freeze({ kind: persisted ? 'failed' as const : 'lost' as const, id: job.id });
  }
  try {
    const result = await input.copier.copy({ domain: job.domain, versionLegacyConvexId: job.versionLegacyConvexId, artifact: job.artifact });
    const persisted = result.status === 'copied' && result.targetAssetId
      ? await input.queue.complete({ id: job.id, claimToken: job.claimToken, targetAssetId: result.targetAssetId })
      : await input.queue.fail({ id: job.id, claimToken: job.claimToken, failureCode: result.failureCode ?? 'asset_copy_failed' });
    return Object.freeze({ kind: persisted && result.status === 'copied' ? 'copied' as const : 'lost' as const, id: job.id });
  } catch (error) {
    const failureCode = error instanceof Error ? error.message.slice(0, 128) : 'asset_copy_failed';
    const persisted = await input.queue.fail({ id: job.id, claimToken: job.claimToken, failureCode });
    return Object.freeze({ kind: persisted ? 'failed' as const : 'lost' as const, id: job.id });
  }
};