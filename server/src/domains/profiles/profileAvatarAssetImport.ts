import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { ManagedAssetStore, StoredManagedAsset } from '../../services/managedAssetStore.js';

export type ProfileAvatarSource = Readonly<{
  legacyStorageId: string;
  originalFileName: string;
  declaredMimeType: string;
  stream: Readable;
}>;

export type ProfileAvatarAsset = Readonly<{
  assetId: string;
  legacyStorageId: string;
  ownerLegacyConvexId: string;
  accessScope: 'public';
  storageKey: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  status: 'active' | 'deleted';
}>;

export type ProfileAvatarAssetRepository = Readonly<{
  findByLegacyStorageId: (legacyStorageId: string) => Promise<ProfileAvatarAsset | null>;
  save: (asset: ProfileAvatarAsset) => Promise<void>;
}>;

export type ProfileAvatarAssetImporter = Readonly<{
  import: (input: Readonly<{ ownerLegacyConvexId: string; source: ProfileAvatarSource }>) => Promise<ProfileAvatarAsset>;
}>;

const fromStoredAsset = (
  ownerLegacyConvexId: string,
  legacyStorageId: string,
  stored: StoredManagedAsset,
): ProfileAvatarAsset => ({
  assetId: randomUUID(),
  legacyStorageId,
  ownerLegacyConvexId,
  accessScope: 'public',
  storageKey: stored.storageKey,
  originalFileName: stored.originalFileName,
  mimeType: stored.mimeType,
  sizeBytes: stored.sizeBytes,
  sha256: stored.sha256,
  status: 'active',
});

export const createProfileAvatarAssetImporter = (
  store: Pick<ManagedAssetStore, 'store'>,
  repository: ProfileAvatarAssetRepository,
): ProfileAvatarAssetImporter =>
  Object.freeze({
    import: async ({ ownerLegacyConvexId, source }) => {
      const existing = await repository.findByLegacyStorageId(source.legacyStorageId);
      if (existing?.status === 'active') return existing;
      const stored = await store.store({
        kind: 'avatar',
        originalFileName: source.originalFileName,
        declaredMimeType: source.declaredMimeType,
        stream: source.stream,
      });
      const asset = fromStoredAsset(ownerLegacyConvexId, source.legacyStorageId, stored);
      await repository.save(asset);
      return asset;
    },
  });