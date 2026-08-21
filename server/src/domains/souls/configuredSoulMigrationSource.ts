import { createFileSoulMigrationSource } from './fileSoulMigrationSource.js';
import type { SoulSnapshot } from './soulMigrationDto.js';
import { normalizeSoulSnapshot } from './soulNormalizer.js';
import type { SoulMigrationSource } from './soulMigrationRuntime.js';

export const SOUL_READ_ONLY_CANDIDATE_CAPABILITY = 'soul-source:readonly-candidate' as const;

type SoulSourceKind = 'file-jsonl' | 'object-jsonl';

export type SoulObjectSnapshotStore = Readonly<{
  read: (key: string) => Promise<Readonly<{ body: string; etag: string }>>;
}>;

const assertCandidateCapability = (environment: NodeJS.ProcessEnv): SoulSourceKind => {
  if (environment.SOUL_SOURCE_CAPABILITY !== SOUL_READ_ONLY_CANDIDATE_CAPABILITY) {
    throw new Error(`SOUL_SOURCE_CAPABILITY must equal ${SOUL_READ_ONLY_CANDIDATE_CAPABILITY}`);
  }
  const kind = environment.SOUL_SOURCE_KIND;
  if (kind !== 'file-jsonl' && kind !== 'object-jsonl') throw new Error('SOUL_SOURCE_KIND must be file-jsonl or object-jsonl');
  if (environment.DATABASE_URL || environment.SITE_URL) {
    throw new Error('Shared database and site variables are not accepted by the candidate Soul source');
  }
  return kind;
};

/** 独立系统的 source 入口；只有显式的候选只读 capability 才能创建。 */
export const createConfiguredSoulSource = (environment: NodeJS.ProcessEnv = process.env, objectStore?: SoulObjectSnapshotStore): SoulMigrationSource => {
  const kind = assertCandidateCapability(environment);
  const path = environment.SOUL_SNAPSHOT_PATH;
  if (kind === 'file-jsonl') {
    if (!path) throw new Error('SOUL_SNAPSHOT_PATH is required for file-jsonl source');
    return createFileSoulMigrationSource({ path });
  }
  const key = environment.SOUL_SNAPSHOT_OBJECT_KEY;
  if (!key || !objectStore) throw new Error('SOUL_SNAPSHOT_OBJECT_KEY and an object-store adapter are required');
  let cached: { etag: string; snapshots: readonly SoulSnapshot[] } | undefined;
  return Object.freeze({
    page: async ({ cursor, limit }) => {
      if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Soul source page limit is invalid');
      const object = await objectStore.read(key);
      const state = cursor ? JSON.parse(cursor) as { etag: string; offset: number } : { etag: object.etag, offset: 0 };
      if (state.etag !== object.etag) throw new Error('Soul object snapshot changed during migration');
      if (!cached || cached.etag !== object.etag) {
        const records = object.body.split(/\r?\n/).filter(Boolean);
        cached = { etag: object.etag, snapshots: records.map((record, index) => {
          try { return normalizeSoulSnapshot(JSON.parse(record) as SoulSnapshot); } catch { throw new Error(`Soul object JSONL record ${index} is invalid`); }
        }) };
      }
      const page = cached.snapshots.slice(state.offset, state.offset + limit);
      const nextOffset = state.offset + page.length;
      const exhausted = nextOffset >= cached.snapshots.length;
      return { snapshots: page, watermark: object.etag, exhausted, cursor: exhausted ? null : JSON.stringify({ etag: object.etag, offset: nextOffset }) };
    },
  });
};