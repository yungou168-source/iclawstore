import { describe, expect, it, vi } from 'bun:test';
import { runProfileProjectionSyncPage } from '../src/domains/profile-projections/profileProjectionSyncOrchestrator.js';

const source = (item: unknown) => ({
  listCatalogItems: vi.fn(async () => ({ items: [item], cursor: null, done: true })),
  listPackageItems: vi.fn(), listStarredItems: vi.fn(), listManifests: vi.fn(),
});

const fixture = (query: (sql: string, values?: readonly unknown[]) => Promise<unknown>) => {
  const connection = { query: vi.fn(query), beginTransaction: vi.fn(async () => {}), commit: vi.fn(async () => {}), rollback: vi.fn(async () => {}), release: vi.fn() };
  return { pool: { query: connection.query, getConnection: vi.fn(async () => connection) }, connection };
};

const catalog = { publisherLegacyConvexId: 'publishers:one', publisherHandle: 'one', item: { legacyConvexId: 'skills:one', kind: 'skill', displayName: 'One', href: '/one/one', canonicalStats: { downloads: 1, stars: 2 }, isOfficial: false, updatedAt: 1 } };

describe('profile projection sync transaction', () => {
  it('rolls back the page when a required Publisher map is absent', async () => {
    const { pool, connection } = fixture(async (sql) => {
      if (sql.includes('convex_exit_migration_batches') && sql.includes('SELECT sourceCursor')) return [[/* no prior state */], []];
      if (sql.includes('convex_exit_legacy_id_maps')) return [[], []];
      return [{ affectedRows: 1 }, []];
    });
    await expect(runProfileProjectionSyncPage({ pool: pool as never, source: source(catalog) as never, batchId: 'batch-1', batchSize: 1 })).rejects.toThrow('Missing Publisher legacy map');
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it('commits a catalog page and persists its source hash idempotently', async () => {
    const { pool, connection } = fixture(async (sql, values) => {
      if (sql.includes('SELECT sourceCursor')) return [[], []];
      if (sql.includes('convex_exit_legacy_id_maps') && values?.[0] === 'publishers') return [[{ targetId: 'publisher-target' }], []];
      if (sql.includes('convex_exit_legacy_id_maps') && values?.[0] === 'profile_catalog_items') return [[], []];
      if (sql.includes('FROM profile_catalog_items')) return [[{ targetId: 'catalog-target', sourceHash: 'same' }], []];
      return [{ affectedRows: 1 }, []];
    });
    const result = await runProfileProjectionSyncPage({ pool: pool as never, source: source(catalog) as never, batchId: 'batch-2', batchSize: 1 });
    expect(result).toEqual({ batchId: 'batch-2', phase: 'catalog', upserted: 1, unchanged: 0, done: false });
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.query).toHaveBeenCalledWith(expect.stringContaining('sourceHash'), expect.any(Array));
  });
});