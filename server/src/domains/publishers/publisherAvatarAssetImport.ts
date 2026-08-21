import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type { ManagedAssetStore, StoredManagedAsset } from "../../services/managedAssetStore.js";

export type PublisherAvatarSource = Readonly<{
  legacyStorageId: string;
  originalFileName: string;
  declaredMimeType: string;
  stream: Readable;
}>;

export type PublisherAvatarAsset = Readonly<{
  assetId: string;
  legacyStorageId: string;
  ownerLegacyConvexId: string;
  accessScope: "public";
  storageKey: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  status: "active" | "deleted";
}>;

export type PublisherAvatarAssetRepository = Readonly<{
  findByLegacyStorageId: (legacyStorageId: string) => Promise<PublisherAvatarAsset | null>;
  save: (asset: PublisherAvatarAsset) => Promise<void>;
}>;

export type PublisherAvatarAssetImporter = Readonly<{
  import: (
    input: Readonly<{
      ownerLegacyConvexId: string;
      source: PublisherAvatarSource;
    }>,
  ) => Promise<PublisherAvatarAsset>;
}>;

const fromStoredAsset = (
  ownerLegacyConvexId: string,
  legacyStorageId: string,
  stored: StoredManagedAsset,
): PublisherAvatarAsset => ({
  assetId: randomUUID(),
  legacyStorageId,
  ownerLegacyConvexId,
  accessScope: "public",
  storageKey: stored.storageKey,
  originalFileName: stored.originalFileName,
  mimeType: stored.mimeType,
  sizeBytes: stored.sizeBytes,
  sha256: stored.sha256,
  status: "active",
});

export const createPublisherAvatarAssetImporter = (
  store: Pick<ManagedAssetStore, "store">,
  repository: PublisherAvatarAssetRepository,
): PublisherAvatarAssetImporter =>
  Object.freeze({
    import: async ({ ownerLegacyConvexId, source }) => {
      const existing = await repository.findByLegacyStorageId(source.legacyStorageId);
      if (existing?.status === "active") return existing;
      const stored = await store.store({
        kind: "avatar",
        originalFileName: source.originalFileName,
        declaredMimeType: source.declaredMimeType,
        stream: source.stream,
      });
      const asset = fromStoredAsset(ownerLegacyConvexId, source.legacyStorageId, stored);
      await repository.save(asset);
      return asset;
    },
  });
