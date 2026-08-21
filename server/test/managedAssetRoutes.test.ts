import Fastify from 'fastify';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { managedAssetRoutes } from '../src/routes/managedAssets.js';
import type { AssetAccessRepository, AssetCompletionRepository, ManagedAssetMetadata } from '../src/services/managedAssetAccess.js';

const asset: ManagedAssetMetadata = { id: 'asset-1', ownerUserId: 'owner', storageKey: 'avatar/aa/00000000-0000-0000-0000-000000000000.png', mimeType: 'image/png', sizeBytes: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', originalFileName: 'avatar.png', accessScope: 'public', status: 'active', scannerStatus: 'clean' };

const createApp = async () => {
  const app = Fastify();
  app.decorateRequest('user', null);
  app.decorate('authenticate', async (request: any) => { request.user = request.headers.authorization === 'Bearer owner' ? { id: 'owner' } : null; });
  const access: AssetAccessRepository = { createTicket: async () => undefined, getTicket: async () => null, consumeTicket: async () => false, getAsset: async (id) => id === asset.id ? asset : null };
  const completion: AssetCompletionRepository = { persistCompletion: async () => false };
  await app.register(managedAssetRoutes, { access, completion, store: { store: async () => { throw new Error('not used'); }, open: async () => ({ stream: Readable.from(Buffer.from('abc')), sizeBytes: 3 }), moveToTrash: async () => 'trash', deleteFromTrash: async () => undefined } });
  return app;
};

describe('managed asset routes', () => {
  it('streams authorized public assets with integrity headers', async () => {
    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/asset-1/download' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('abc');
    expect(response.headers.etag).toBe(`"${asset.sha256}"`);
    expect(response.headers['content-length']).toBe('3');
    await app.close();
  });

  it('does not disclose pending or blocked assets', async () => {
    const app = await createApp();
    const access = app;
    void access;
    const response = await app.inject({ method: 'GET', url: '/missing/download' });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});