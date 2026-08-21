import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { packagesRoutes } from '../src/routes/packages.js';
import { skillsRoutes } from '../src/routes/skills.js';
import type { CatalogEntry, PublicCatalogPort } from '../src/domains/skill-packages/publicCatalogPort.js';

const entry: CatalogEntry = {
  id: 'pkg-1', name: 'demo', displayName: 'Demo', summary: 'Public package',
  owner: { id: 'user-1', handle: 'demo-user', displayName: 'Demo User', image: null },
  publisher: null, latestVersion: null, updatedAt: new Date(0).toISOString(), tags: [], stats: {},
};

const catalog: PublicCatalogPort = {
  list: async () => ({ items: [entry], pagination: { page: 1, limit: 20, total: 1, pages: 1 } }),
  resolve: async ({ name }) => name === 'demo' ? entry : null,
  getById: async ({ id }) => id === entry.id ? entry : null,
  listVersions: async ({ id }) => id === entry.id ? { versions: [], total: 0 } : null,
  getVersion: async () => null,
};

describe('package public read contract', () => {
  it('supports list, resolve, version pagination, and not-found responses', async () => {
    const app = Fastify();
    await app.register(packagesRoutes, { catalog });
    await app.ready();

    await expect(app.inject('/').then((response) => response.json())).resolves.toMatchObject({
      items: [{ id: 'pkg-1', name: 'demo' }],
      pagination: { total: 1 },
    });
    await expect(app.inject('/resolve/demo').then((response) => response.statusCode)).resolves.toBe(200);
    await expect(app.inject('/missing').then((response) => response.statusCode)).resolves.toBe(404);
    await expect(app.inject('/pkg-1/versions').then((response) => response.json())).resolves.toMatchObject({
      versions: [], pagination: { total: 0 },
    });
    await expect(app.inject('/pkg-1/versions?limit=0').then((response) => response.json())).resolves.toEqual({
      error: 'page and limit must be positive integers',
    });
    await expect(app.inject('/pkg-1/versions?page=nope').then((response) => response.statusCode)).resolves.toBe(400);
    await app.close();
  });

  it('does not advertise an artifact URL before asset migration', async () => {
    const app = Fastify();
    await app.register(packagesRoutes, { catalog });
    await app.ready();
    const response = await app.inject('/pkg-1/versions/1.0.0/artifacts/archive.zip');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'Artifact download is unavailable until managed asset migration completes' });
    await app.close();
  });
  it('serves the same read contract for skills, including version details', async () => {
    const version = {
      id: 'skill-version-1', version: '1.0.0', createdAt: new Date(0).toISOString(), changelog: 'Initial', sha256: 'abc',
      artifacts: [{ path: 'README.md', mimeType: 'text/markdown', sizeBytes: 10, sha256: 'def', available: false as const }],
    };
    const skillCatalog: PublicCatalogPort = {
      ...catalog,
      getVersion: async ({ domain, version: requestedVersion }) => domain === 'skill' && requestedVersion === version.version ? version : null,
    };
    const app = Fastify();
    await app.register(skillsRoutes, { catalog: skillCatalog });
    await app.ready();

    await expect(app.inject('/resolve/demo').then((response) => response.statusCode)).resolves.toBe(200);
    await expect(app.inject('/pkg-1/versions/1.0.0').then((response) => response.json())).resolves.toEqual(version);
    await expect(app.inject('/?page=0').then((response) => response.statusCode)).resolves.toBe(400);
    await app.close();
  });
});