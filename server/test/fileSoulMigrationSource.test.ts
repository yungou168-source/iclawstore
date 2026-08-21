import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileSoulMigrationSource } from '../src/domains/souls/fileSoulMigrationSource.js';

const snapshot = (id: string, updatedAt: number) => ({
  legacyConvexId: id, slug: id, displayName: id, summary: null,
  ownerUserLegacyConvexId: 'user:1', ownerPublisherLegacyConvexId: null,
  latestVersionLegacyConvexId: null, tags: {}, stats: {}, legacyCreatedAt: updatedAt,
  legacyUpdatedAt: updatedAt, softDeletedAt: null, sourceHash: '0'.repeat(64), versions: [],
});

describe('independent Soul file source', () => {
  it('paginates JSONL snapshots and rejects source mutation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'soul-source-'));
    const path = join(directory, 'snapshots.jsonl');
    await writeFile(path, `${JSON.stringify(snapshot('one', 1))}\n${JSON.stringify(snapshot('two', 2))}\n`);
    const source = createFileSoulMigrationSource({ path });
    const first = await source.page({ cursor: null, limit: 1 });
    expect(first.snapshots).toHaveLength(1);
    expect(first.exhausted).toBe(false);
    await writeFile(path, `${JSON.stringify(snapshot('changed', 3))}\n`);
    await expect(source.page({ cursor: first.cursor, limit: 1 })).rejects.toThrow('changed during migration');
  });
});