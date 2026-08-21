import type { ProfileAvatarAsset } from './profileAvatarAssetImport.js';
import {
  reconcileProfileAvatarAsset,
  reconcileProfileAliases,
  reconcileProfileSnapshots,
  type ProfileIdentityAlias,
  type ProfileReconciliationDifference,
  type ProfileReconciliationSnapshot,
} from './profileReconciliation.js';

export type ProfileReconciliationSource = Readonly<{
  profiles: () => AsyncIterable<ProfileReconciliationSnapshot>;
  avatarMetadata: (
    storageId: string,
  ) => Promise<Pick<ProfileAvatarAsset, 'mimeType' | 'sizeBytes' | 'sha256'> | null>;
}>;

export type ProfileReconciliationTarget = Readonly<{
  findProfile: (legacyConvexId: string) => Promise<ProfileReconciliationSnapshot | null>;
  listLegacyConvexIds: () => Promise<readonly string[]>;
  listAliases: (legacyConvexId: string) => Promise<readonly ProfileIdentityAlias[]>;
  findAvatar: (
    legacyConvexId: string,
  ) => Promise<Pick<ProfileAvatarAsset, 'legacyStorageId' | 'mimeType' | 'sizeBytes' | 'sha256' | 'status'> | null>;
}>;

export type ProfileReconciliationSink = Readonly<{
  record: (input: ProfileReconciliationDifference & Readonly<{
    batchId: string;
    classification: 'unclassified';
  }>) => Promise<void>;
}>;

export type ProfileReconciliationSummary = Readonly<{
  batchId: string;
  sourceProfiles: number;
  targetProfiles: number;
  comparedProfiles: number;
  differences: number;
  unclassifiedDifferences: number;
  candidateReady: boolean;
}>;

const aliasKey = (alias: Pick<ProfileIdentityAlias, 'aliasKind' | 'aliasValue'>): string =>
  `${alias.aliasKind}:${alias.aliasValue.trim().toLowerCase()}`;

const aliasEvidence = (
  source: ProfileReconciliationSnapshot,
  target: readonly ProfileIdentityAlias[],
  difference: ProfileReconciliationDifference,
): ProfileReconciliationDifference => {
  if (!difference.fieldName.startsWith('aliases.')) return difference;
  const [, aliasKind, ...valueParts] = difference.fieldName.split('.');
  const aliasValue = valueParts.join('.');
  const sourceAlias = (source.aliases ?? []).find(
    (alias) => aliasKey(alias) === aliasKey({ aliasKind: aliasKind as ProfileIdentityAlias['aliasKind'], aliasValue }),
  );
  const targetAlias = target.find(
    (alias) => aliasKey(alias) === aliasKey({ aliasKind: aliasKind as ProfileIdentityAlias['aliasKind'], aliasValue }),
  );
  return {
    ...difference,
    sourceEvidence: {
      profileLegacyConvexId: source.legacyConvexId,
      alias: sourceAlias ?? null,
      canonicalProfileValue: aliasKind === 'user_handle' ? source.handle : source.profileSlug,
    },
    targetEvidence: {
      alias: targetAlias ?? null,
    },
  };
};

const recordDifferences = async (
  sink: ProfileReconciliationSink,
  batchId: string,
  differences: readonly ProfileReconciliationDifference[],
  sourceProfile?: ProfileReconciliationSnapshot,
  targetAliases: readonly ProfileIdentityAlias[] = [],
): Promise<number> => {
  for (const difference of differences) {
    const auditedDifference = sourceProfile
      ? aliasEvidence(sourceProfile, targetAliases, difference)
      : difference;
    await sink.record({ ...auditedDifference, batchId, classification: 'unclassified' });
  }
  return differences.length;
};

export type ProfileReconciliationPageSummary = Readonly<{
  sourceProfiles: number;
  comparedProfiles: number;
  differences: number;
  sourceIds: ReadonlySet<string>;
}>;

export const reconcileProfilePage = async (input: Readonly<{
  batchId: string;
  profiles: readonly ProfileReconciliationSnapshot[];
  source: Pick<ProfileReconciliationSource, 'avatarMetadata'>;
  target: Pick<ProfileReconciliationTarget, 'findProfile' | 'listAliases' | 'findAvatar'>;
  sink: ProfileReconciliationSink;
}>): Promise<ProfileReconciliationPageSummary> => {
  const sourceIds = new Set<string>();
  let differences = 0;
  for (const sourceProfile of input.profiles) {
    sourceIds.add(sourceProfile.legacyConvexId);
    const [targetProfile, targetAliases, targetAvatar] = await Promise.all([
      input.target.findProfile(sourceProfile.legacyConvexId),
      input.target.listAliases(sourceProfile.legacyConvexId),
      input.target.findAvatar(sourceProfile.legacyConvexId),
    ]);
    differences += await recordDifferences(
      input.sink,
      input.batchId,
      reconcileProfileSnapshots(sourceProfile, targetProfile),
      sourceProfile,
      targetAliases,
    );
    differences += await recordDifferences(
      input.sink,
      input.batchId,
      reconcileProfileAliases(sourceProfile, targetAliases),
      sourceProfile,
      targetAliases,
    );
    const sourceAvatar = sourceProfile.imageStorageId
      ? await input.source.avatarMetadata(sourceProfile.imageStorageId)
      : null;
    differences += await recordDifferences(
      input.sink,
      input.batchId,
      reconcileProfileAvatarAsset(sourceProfile.legacyConvexId, sourceProfile.imageStorageId, sourceAvatar, targetAvatar),
    );
  }
  return {
    sourceProfiles: input.profiles.length,
    comparedProfiles: input.profiles.length,
    differences,
    sourceIds,
  };
};

export type ProfileReconciliationPagedSource = Readonly<{
  readPage: (input: Readonly<{
    cursor: string | null;
    watermark: number | null;
  }>) => Promise<Readonly<{
    profiles: readonly ProfileReconciliationSnapshot[];
    nextCursor: string | null;
    done: boolean;
    watermark: number;
  }>>;
}>;

export type ProfileReconciliationPageCheckpoint = Readonly<{
  sourceCursor: string | null;
  sourceWatermark: number;
  sourceProfiles: number;
  comparedProfiles: number;
  differences: number;
  sourceExhausted: boolean;
  completed: boolean;
}>;

/**
 * Drives source pagination without deciding how a page is persisted. The caller's
 * `commitPage` must atomically record that page's differences and advance its
 * checkpoint. `finalize` records target-only differences before the checkpoint
 * is marked complete; throwing leaves the batch resumable at its last page.
 */
export const runProfileReconciliationPages = async (input: Readonly<{
  checkpoint: ProfileReconciliationPageCheckpoint | null;
  source: ProfileReconciliationPagedSource;
  commitPage: (input: Readonly<{
    profiles: readonly ProfileReconciliationSnapshot[];
    nextCursor: string | null;
    done: boolean;
    watermark: number;
  }>) => Promise<void>;
  finalize: () => Promise<void>;
}>): Promise<void> => {
  if (input.checkpoint?.completed) return;
  if (input.checkpoint?.sourceExhausted) {
    await input.finalize();
    return;
  }
  let cursor = input.checkpoint?.sourceCursor ?? null;
  const watermark = input.checkpoint?.sourceWatermark ?? null;
  do {
    const page = await input.source.readPage({ cursor, watermark });
    if (watermark !== null && page.watermark !== watermark) {
      throw new Error('Profile reconciliation source watermark changed during a batch');
    }
    await input.commitPage(page);
    cursor = page.nextCursor;
    if (page.done) {
      await input.finalize();
      return;
    }
    if (!cursor) throw new Error('Profile reconciliation page is incomplete without a continuation cursor');
  } while (true);
};


export const runProfileReconciliation = async (input: Readonly<{
  batchId: string;
  source: ProfileReconciliationSource;
  target: ProfileReconciliationTarget;
  sink: ProfileReconciliationSink;
}>): Promise<ProfileReconciliationSummary> => {
  const sourceIds = new Set<string>();
  let sourceProfiles = 0;
  let comparedProfiles = 0;
  let differences = 0;

  for await (const sourceProfile of input.source.profiles()) {
    sourceProfiles += 1;
    sourceIds.add(sourceProfile.legacyConvexId);
    const [targetProfile, targetAliases, targetAvatar] = await Promise.all([
      input.target.findProfile(sourceProfile.legacyConvexId),
      input.target.listAliases(sourceProfile.legacyConvexId),
      input.target.findAvatar(sourceProfile.legacyConvexId),
    ]);
    comparedProfiles += 1;
    differences += await recordDifferences(
      input.sink,
      input.batchId,
      reconcileProfileSnapshots(sourceProfile, targetProfile),
    );
    differences += await recordDifferences(
      input.sink,
      input.batchId,
      reconcileProfileAliases(sourceProfile, targetAliases),
    );

    const sourceAvatar = sourceProfile.imageStorageId
      ? await input.source.avatarMetadata(sourceProfile.imageStorageId)
      : null;
    differences += await recordDifferences(
      input.sink,
      input.batchId,
      reconcileProfileAvatarAsset(
        sourceProfile.legacyConvexId,
        sourceProfile.imageStorageId,
        sourceAvatar,
        targetAvatar,
      ),
    );
  }

  const targetIds = await input.target.listLegacyConvexIds();
  for (const legacyConvexId of targetIds) {
    if (sourceIds.has(legacyConvexId)) continue;
    differences += await recordDifferences(
      input.sink,
      input.batchId,
      reconcileProfileSnapshots(null, {
        legacyConvexId,
        handle: null,
        profileSlug: null,
        personalPublisherLegacyConvexId: null,
        deletedAt: null,
        deactivatedAt: null,
        purgedAt: null,
        banReason: null,
        imageStorageId: null,
      }),
    );
  }

  return {
    batchId: input.batchId,
    sourceProfiles,
    targetProfiles: targetIds.length,
    comparedProfiles,
    differences,
    unclassifiedDifferences: differences,
    candidateReady: differences === 0,
  };
};