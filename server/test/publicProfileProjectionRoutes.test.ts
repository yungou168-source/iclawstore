import { afterEach, describe, expect, it, vi } from 'bun:test';
import Fastify from 'fastify';
import { publicProfileProjectionRoutes } from '../src/routes/publicProfileProjections.js';

const apps: Array<ReturnType<typeof Fastify>> = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

const projections = {
  listCatalog: vi.fn(async () => ({ page: [], continueCursor: '', isDone: true })),
  listStarred: vi.fn(async () => ({ page: [], continueCursor: '', isDone: true })),
  getCatalogDisplay: vi.fn(async () => null),
};

describe('public profile projection routes', () => {
  it('freezes catalog, stars and manifest response contracts', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(publicProfileProjectionRoutes, { projections });
    expect((await app.inject({ method: 'GET', url: '/publishers/acme/catalog?kind=skill&sort=recent&numItems=12' })).json()).toEqual({ page: [], continueCursor: '', isDone: true });
    expect((await app.inject({ method: 'GET', url: '/publishers/acme/starred?numItems=12' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/publishers/acme/catalog-display' })).json()).toBeNull();
    expect(projections.listCatalog).toHaveBeenCalledWith({ handle: 'acme', kind: 'skill', sort: 'recent', paginationOpts: { cursor: null, numItems: 12 } });
  });

  it('rejects invalid public page limits', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(publicProfileProjectionRoutes, { projections });
    const response = await app.inject({ method: 'GET', url: '/publishers/acme/catalog?numItems=25' });
    expect(response.statusCode).toBe(500);
  });
});