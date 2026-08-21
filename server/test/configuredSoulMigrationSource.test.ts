import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfiguredSoulSource, SOUL_READ_ONLY_CANDIDATE_CAPABILITY } from '../src/domains/souls/configuredSoulMigrationSource.js';

const snapshot = {
  legacyConvexId: 'soul:one', slug: 'one', displayName: 'One', summary: null,
  ownerUserLegacyConvexId: 'user:one', ownerPublisherLegacyConvexId: null,
  latestVersionLegacyConvexId: null, tags: {}, stats: {}, legacyCreatedAt: 1,
  legacyUpdatedAt: 1, softDeletedAt: null, sourceHash: '0'.repeat(64), versions: [],
};

describe('configured candidate Soul source', () => {
  it('requires the explicit read-only candidate capability', async () => {
    expect(() => createConfiguredSoulSource({ SOUL_SOURCE_KIND: 'file-jsonl', SOUL_SNAPSHOT_PATH: '/tmp/souls.jsonl' }))
      .toThrow(`SOUL_SOURCE_CAPABILITY must equal ${SOUL_READ_ONLY_CANDIDATE_CAPABILITY}`);
  });

  it('rejects shared database or site variables even when capability is present', () => {
    expect(() => createConfiguredSoulSource({
      SOUL_SOURCE_CAPABILITY: SOUL_READ_ONLY_CANDIDATE_CAPABILITY,
      SOUL_SOURCE_KIND: 'file-jsonl', SOUL_SNAPSHOT_PATH: '/tmp/souls.jsonl', DATABASE_URL: 'mysql://forbidden.example/souls',
    })).toThrow('Shared database and site variables are not accepted');
  });

  it('reads an explicitly authorized non-production file source', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'soul-candidate-source-'));
    const path = join(directory, 'snapshots.jsonl');
    await writeFile(path, `${JSON.stringify(snapshot)}\n`);
    const source = createConfiguredSoulSource({
      SOUL_SOURCE_CAPABILITY: SOUL_READ_ONLY_CANDIDATE_CAPABILITY,
      SOUL_SOURCE_KIND: 'file-jsonl', SOUL_SNAPSHOT_PATH: path,
    });
    await expect(source.page({ cursor: null, limit: 10 })).resolves.toMatchObject({ exhausted: true, snapshots: [snapshot] });
  });
});