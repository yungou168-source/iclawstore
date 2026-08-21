import type {
  OpenedManagedAsset,
  StoreManagedAssetInput,
  StoredManagedAsset,
} from './managedAssetStore.js';

export type ManagedAssetPort = Readonly<{
  store: (input: StoreManagedAssetInput) => Promise<StoredManagedAsset>;
  open: (storageKey: string) => Promise<OpenedManagedAsset>;
  moveToTrash: (storageKey: string) => Promise<string>;
  deleteFromTrash: (trashName: string) => Promise<void>;
}>;