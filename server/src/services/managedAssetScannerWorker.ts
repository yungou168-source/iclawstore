import { createHash } from 'node:crypto';
import type { ManagedAssetPort } from './managedAssetPort.js';
import type { ManagedAssetMetadata } from './managedAssetAccess.js';

export type ManagedAssetScanRepository = Readonly<{
  listPendingAssets: (limit: number) => Promise<readonly ManagedAssetMetadata[]>;
  setScannerStatus: (id: string, status: 'clean' | 'blocked') => Promise<void>;
}>;

export type ManagedAssetScanner = Readonly<{
  scan: (input: Readonly<{ asset: ManagedAssetMetadata; bytes: Buffer }>) => Promise<'clean' | 'blocked'>;
}>;

export const scanPendingManagedAssets = async (
  repository: ManagedAssetScanRepository,
  store: ManagedAssetPort,
  scanner: ManagedAssetScanner,
  limit = 20,
) => {
  const assets = await repository.listPendingAssets(Math.min(Math.max(limit, 1), 100));
  let clean = 0;
  let blocked = 0;
  for (const asset of assets) {
    const opened = await store.open(asset.storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of opened.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (bytes.byteLength !== asset.sizeBytes || sha256 !== asset.sha256) {
      await repository.setScannerStatus(asset.id, 'blocked');
      blocked += 1;
      continue;
    }
    const status = await scanner.scan({ asset, bytes });
    await repository.setScannerStatus(asset.id, status);
    if (status === 'clean') clean += 1;
    else blocked += 1;
  }
  return { scanned: assets.length, clean, blocked };
};