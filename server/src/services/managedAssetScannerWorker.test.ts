import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { scanPendingManagedAssets } from './managedAssetScannerWorker.js';

const sha256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('managed asset scanner worker', () => {
  it('blocks integrity failures before invoking scanner', async () => {
    const statuses: string[] = [];
    const result = await scanPendingManagedAssets({ listPendingAssets: async () => [{ id: 'asset', ownerUserId: 'user', storageKey: 'avatar/aa/00000000-0000-0000-0000-000000000000.png', mimeType: 'image/png', sizeBytes: 3, sha256, originalFileName: 'a.png', accessScope: 'owner', status: 'active', scannerStatus: 'pending' }], setScannerStatus: async (_id, status) => void statuses.push(status) }, { open: async () => ({ stream: Readable.from(Buffer.from('bad')), sizeBytes: 3 }), store: async () => { throw new Error('not used'); }, moveToTrash: async () => 'trash', deleteFromTrash: async () => undefined }, { scan: async () => 'clean' });
    expect(result).toEqual({ scanned: 1, clean: 0, blocked: 1 });
    expect(statuses).toEqual(['blocked']);
  });
});