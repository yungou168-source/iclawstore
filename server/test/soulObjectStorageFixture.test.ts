import { describe, expect, it } from 'vitest';
import { createConfiguredSoulSource, SOUL_READ_ONLY_CANDIDATE_CAPABILITY } from '../src/domains/souls/configuredSoulMigrationSource.js';

const snapshot = (id: string) => ({
  legacyConvexId: id, slug: id, displayName: id, summary: null,
  ownerUserLegacyConvexId: 'user:1', ownerPublisherLegacyConvexId: null,
  latestVersionLegacyConvexId: null, tags: {}, stats: {}, legacyCreatedAt: 1,
  legacyUpdatedAt: 1, softDeletedAt: null, sourceHash: '0'.repeat(64), versions: [],
});

describe('Soul object storage fixture', () => {
  it('fails closed on a transient object read and resumes from the last cursor', async () => {
    let reads = 0;
    const source = createConfiguredSoulSource({ SOUL_SOURCE_CAPABILITY: SOUL_READ_ONLY_CANDIDATE_CAPABILITY, SOUL_SOURCE_KIND: 'object-jsonl', SOUL_SNAPSHOT_OBJECT_KEY: 'fixtures/souls.jsonl' }, {
      read: async () => {
        reads += 1;
        if (reads === 1) throw new Error('object store timeout');
        return { etag: 'fixture-v1', body: `${JSON.stringify(snapshot('one'))}\n${JSON.stringify(snapshot('two'))}\n` };
      },
    });
    await expect(source.page({ cursor: null, limit: 1 })).rejects.toThrow('object store timeout');
    const page = await source.page({ cursor: null, limit: 1 });
    expect(page.snapshots[0].legacyConvexId).toBe('one');
    expect(page.cursor).toContain('fixture-v1');
  });

  it('rejects invalid page limits before consuming object records', async () => {
    let reads = 0;
    const source = createConfiguredSoulSource({ SOUL_SOURCE_CAPABILITY: SOUL_READ_ONLY_CANDIDATE_CAPABILITY, SOUL_SOURCE_KIND: 'object-jsonl', SOUL_SNAPSHOT_OBJECT_KEY: 'fixtures/souls.jsonl' }, {
      read: async () => {
        reads += 1;
        return { etag: 'fixture-v1', body: JSON.stringify(snapshot('one')) };
      },
    });
    await expect(source.page({ cursor: null, limit: 0 })).rejects.toThrow('page limit is invalid');
    expect(reads).toBe(0);
  });

  it('keeps ETag stable across pages and fails closed after replacement', async () => {
    let current = { etag: 'fixture-v1', body: `${JSON.stringify(snapshot('one'))}\n${JSON.stringify(snapshot('two'))}\n` };
    const source = createConfiguredSoulSource({ SOUL_SOURCE_CAPABILITY: SOUL_READ_ONLY_CANDIDATE_CAPABILITY, SOUL_SOURCE_KIND: 'object-jsonl', SOUL_SNAPSHOT_OBJECT_KEY: 'fixtures/souls.jsonl' }, { read: async () => current });
    const first = await source.page({ cursor: null, limit: 1 });
    expect(first.snapshots[0].legacyConvexId).toBe('one');
    current = { etag: 'fixture-v2', body: JSON.stringify(snapshot('new')) };
    await expect(source.page({ cursor: first.cursor, limit: 1 })).rejects.toThrow('changed during migration');
  });
});
