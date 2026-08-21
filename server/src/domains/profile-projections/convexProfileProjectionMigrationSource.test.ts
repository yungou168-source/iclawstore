import { describe, expect, it, vi } from 'vitest';
import {
  createConvexProfileProjectionSource,
  createConvexPublishedCatalogProjectionSource,
} from './convexProfileProjectionMigrationSource';

describe('Convex published Skill projection source', () => {
  it('exposes only the catalog paging capability', async () => {
    const query = vi.fn().mockResolvedValue({ items: [], cursor: null, done: true });
    const source = createConvexPublishedCatalogProjectionSource({ query });

    await expect(source.listCatalogItems({ cursor: null, limit: 25 })).resolves.toEqual({
      items: [],
      cursor: null,
      done: true,
    });
    await expect(source.listPackageItems({ cursor: 'next', limit: 10 })).resolves.toEqual({
      items: [],
      cursor: null,
      done: true,
    });
    expect(query).toHaveBeenCalledWith(expect.anything(), { cursor: 'next', limit: 10 });
    expect('listStarredItems' in source).toBe(false);
    expect('listManifests' in source).toBe(false);
  });

  it('exposes starred and manifest snapshots through the same narrow query capability', async () => {
    const query = vi.fn().mockResolvedValue({ items: [], cursor: null, done: true });
    const source = createConvexProfileProjectionSource({ query });

    await expect(source.listStarredItems({ cursor: 'star-page', limit: 10 })).resolves.toEqual({
      items: [],
      cursor: null,
      done: true,
    });
    await expect(source.listManifests({ cursor: 'manifest-page', limit: 12 })).resolves.toEqual({
      items: [],
      cursor: null,
      done: true,
    });
    expect(query).toHaveBeenCalledWith(expect.anything(), { cursor: 'star-page', limit: 10 });
    expect(query).toHaveBeenCalledWith(expect.anything(), { cursor: 'manifest-page', limit: 12 });
  });
});