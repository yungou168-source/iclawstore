import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createFakeManagedAssetPort } from '../src/services/fakeManagedAssetPort.js';

const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
]);

describe('fake managed asset port', () => {
  it('stores bytes with a deterministic integrity record and supports trash lifecycle', async () => {
    const port = createFakeManagedAssetPort();
    const stored = await port.store({
      kind: 'avatar',
      originalFileName: 'avatar.png',
      declaredMimeType: 'image/png',
      stream: Readable.from([png]),
    });
    expect(stored.sizeBytes).toBe(png.length);
    expect(stored.sha256).toHaveLength(64);
    expect((await port.open(stored.storageKey)).sizeBytes).toBe(png.length);
    const trashName = await port.moveToTrash(stored.storageKey);
    await expect(port.open(stored.storageKey)).rejects.toThrow('ASSET_NOT_FOUND');
    expect(port.trash.has(trashName)).toBe(true);
    await port.deleteFromTrash(trashName);
    expect(port.trash.has(trashName)).toBe(false);
  });

  it('rejects invalid names, MIME declarations, and content signatures', async () => {
    const port = createFakeManagedAssetPort();
    await expect(port.store({ kind: 'avatar', originalFileName: 'avatar.png.exe', declaredMimeType: 'image/png', stream: Readable.from([png]) })).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
    await expect(port.store({ kind: 'avatar', originalFileName: 'avatar.png', declaredMimeType: 'text/plain', stream: Readable.from([png]) })).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
    await expect(port.store({ kind: 'avatar', originalFileName: 'avatar.png', declaredMimeType: 'image/png', stream: Readable.from([Buffer.from('not an image')]) })).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
  });
});