import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import {
  managedAssetDownloadHeaders,
  ManagedAssetStore,
} from '../src/services/managedAssetStore.js';

const temporaryRoots: string[] = [];

async function createStore(): Promise<ManagedAssetStore> {
  const root = await mkdtemp(join(tmpdir(), 'managed-assets-'));
  temporaryRoots.push(root);
  return new ManagedAssetStore(root);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('ManagedAssetStore', () => {
  it('streams a validated image into an atomic managed key and reopens it', async () => {
    const store = await createStore();
    const png = createPngHeader(640, 480);
    const stored = await store.store({
      kind: 'avatar',
      originalFileName: 'avatar.png',
      declaredMimeType: 'image/png',
      stream: Readable.from(png),
    });

    expect(stored.storageKey).toMatch(/^avatar\/[a-f0-9]{2}\/[a-f0-9-]{36}\.png$/);
    expect(stored.mimeType).toBe('image/png');
    expect(stored.sizeBytes).toBe(png.length);
    expect(stored.sha256).toHaveLength(64);

    const opened = await store.open(stored.storageKey);
    expect(opened.sizeBytes).toBe(png.length);
    expect(Buffer.concat(await collect(opened.stream))).toEqual(png);
    expect(await readdir(join(store.root, '.tmp'))).toEqual([]);
  });

  it('rejects traversal keys, double extensions, and MIME spoofing', async () => {
    const store = await createStore();
    await expect(store.open('../secret.png')).rejects.toMatchObject({ code: 'INVALID_STORAGE_KEY' });

    await expect(store.store({
      kind: 'avatar',
      originalFileName: 'payload.svg.png',
      declaredMimeType: 'image/png',
      stream: Readable.from(createPngHeader(1, 1)),
    })).rejects.toMatchObject({ code: 'INVALID_FILE_NAME' });

    await expect(store.store({
      kind: 'avatar',
      originalFileName: 'avatar.png',
      declaredMimeType: 'image/png',
      stream: Readable.from(Buffer.from('<svg></svg>')),
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE', statusCode: 415 });
    expect(await readdir(join(store.root, '.tmp'))).toEqual([]);
  });

  it('accepts a self-contained GLB and rejects external model resources', async () => {
    const store = await createStore();
    const valid = createGlb({ asset: { version: '2.0' }, buffers: [{ byteLength: 0 }] });
    const stored = await store.store({
      kind: 'model_3d',
      originalFileName: 'agent.glb',
      declaredMimeType: 'model/gltf-binary',
      stream: Readable.from(valid),
    });
    expect(stored.mimeType).toBe('model/gltf-binary');

    const external = createGlb({
      asset: { version: '2.0' },
      buffers: [{ byteLength: 4, uri: 'https://example.invalid/model.bin' }],
    });
    await expect(store.store({
      kind: 'model_3d',
      originalFileName: 'external.glb',
      declaredMimeType: 'model/gltf-binary',
      stream: Readable.from(external),
    })).rejects.toMatchObject({ code: 'INVALID_GLB' });
  });

  it('validates template manifest, required files, and archive traversal', async () => {
    const store = await createStore();
    const manifest = JSON.stringify({
      schemaVersion: 1,
      id: 'com.example.workbench',
      name: '个人工作台',
      description: '本地工作台',
      version: '1.0.0',
      entry: 'index.html',
      author: { name: 'Example', publisherId: 'publisher-1' },
      screenshots: ['screenshots/01.png'],
      dataSchemaVersion: 1,
      capabilities: ['local-storage', 'markdown-import', 'markdown-export'],
    });
    const archive = createStoredZip([
      ['manifest.json', Buffer.from(manifest)],
      ['index.html', Buffer.from('<!doctype html><title>Workbench</title>')],
      ['screenshots/01.png', createPngHeader(320, 180)],
    ]);
    const stored = await store.store({
      kind: 'template_package',
      originalFileName: 'workbench.clawtemplate',
      declaredMimeType: 'application/zip',
      stream: Readable.from(archive),
    });
    expect(stored.mimeType).toBe('application/zip');

    const unsafeArchive = createStoredZip([
      ['manifest.json', Buffer.from(manifest)],
      ['index.html', Buffer.from('<!doctype html>')],
      ['screenshots/01.png', createPngHeader(1, 1)],
      ['../escape.txt', Buffer.from('escape')],
    ]);
    await expect(store.store({
      kind: 'template_package',
      originalFileName: 'unsafe.clawtemplate',
      declaredMimeType: 'application/zip',
      stream: Readable.from(unsafeArchive),
    })).rejects.toMatchObject({ code: 'INVALID_TEMPLATE_PACKAGE' });
  });

  it('moves soft-deleted files to an isolated trash key and emits safe download headers', async () => {
    const store = await createStore();
    const stored = await store.store({
      kind: 'sidebar_icon',
      originalFileName: 'logo.png',
      declaredMimeType: 'image/png',
      stream: Readable.from(createPngHeader(32, 32)),
    });
    const trashName = await store.moveToTrash(stored.storageKey);
    await expect(store.open(stored.storageKey)).rejects.toBeTruthy();
    await store.deleteFromTrash(trashName);

    expect(managedAssetDownloadHeaders({
      mimeType: stored.mimeType,
      sha256: stored.sha256,
      originalFileName: '模板 包.clawtemplate',
      attachment: true,
    })).toMatchObject({
      'Content-Type': 'image/png',
      'X-Content-Type-Options': 'nosniff',
      ETag: `"${stored.sha256}"`,
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
  });

  it('requires an absolute managed root', () => {
    expect(() => new ManagedAssetStore('relative/assets')).toThrow('绝对路径');
    expect(() => ManagedAssetStore.fromEnvironment({})).toThrow('MANAGED_ASSET_ROOT');
  });
});

function createPngHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function createGlb(document: unknown): Buffer {
  const rawJson = Buffer.from(JSON.stringify(document));
  const paddedLength = Math.ceil(rawJson.length / 4) * 4;
  const json = Buffer.alloc(paddedLength, 0x20);
  rawJson.copy(json);
  const glb = Buffer.alloc(20 + json.length);
  glb.writeUInt32LE(0x46546c67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(json.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  json.copy(glb, 20);
  return glb;
}

function createStoredZip(files: Array<[string, Buffer]>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const [name, data] of files) {
    const nameBuffer = Buffer.from(name);
    const local = Buffer.alloc(30 + nameBuffer.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    nameBuffer.copy(local, 30);
    localParts.push(local, data);

    const central = Buffer.alloc(46 + nameBuffer.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(localOffset, 42);
    nameBuffer.copy(central, 46);
    centralParts.push(central);
    localOffset += local.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

async function collect(stream: Readable): Promise<Buffer[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks;
}
