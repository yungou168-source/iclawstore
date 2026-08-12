import { describe, expect, it, vi } from 'bun:test';
import { runProfileBackfill, runProfileBackfillToCompletion } from '../src/profileBackfillProcess.js';

const snapshot = {
  legacyConvexId: 'users:1',
  legacyCreationTime: 1,
  name: 'alice',
  handle: 'alice',
  profileSlug: 'alice',
  displayName: 'Alice',
  bio: null,
  image: null,
  imageStorageId: null,
  developerStatus: null,
  developerAppliedAt: null,
  developerApprovedAt: null,
  role: 'user',
  trustedPublisher: false,
  publishedSkills: 0,
  totalStars: 0,
  totalDownloads: 0,
  personalPublisherLegacyConvexId: null,
  deletedAt: null,
  deactivatedAt: null,
  purgedAt: null,
  banReason: null,
  legacyCreatedAt: null,
  legacyUpdatedAt: null,
};

const poolFor = (cursorDone = false) => {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('SELECT cursorValue')) return [[{ cursorValue: null, isComplete: cursorDone }], []];
    if (sql.includes('SELECT sourceHash')) return [[], []];
    if (sql.includes('SELECT id FROM profile_snapshots')) return [[{ id: 'mysql-profile-1' }], []];
    return [{ affectedRows: 1 }, []];
  });
  return { query };
};

describe('profile backfill', () => {
  it('persists the cursor only after profile upserts and can resume idempotently', async () => {
    const pool = poolFor();
    const convex = { query: vi.fn(async () => ({ items: [snapshot], cursor: 'next', done: false })) };
    const first = await runProfileBackfill({ pool: pool as never, convex: convex as never, batchId: 'batch-1', batchSize: 10 });
    expect(first).toEqual({ batchId: 'batch-1', upserted: 1, unchanged: 0, done: false });
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE profile_migration_cursors'))).toBe(true);
  });

  it('does not invoke Convex after a completed cursor is resumed', async () => {
    const pool = poolFor(true);
    const convex = { query: vi.fn() };
    const result = await runProfileBackfill({ pool: pool as never, convex: convex as never, batchId: 'batch-1', batchSize: 10 });
    expect(result.done).toBe(true);
    expect(convex.query).not.toHaveBeenCalled();
  });

  it('continues through every cursor page and aggregates outcomes', async () => {
    let cursorValue: string | null = null;
    let isComplete = false;
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT cursorValue')) return [[{ cursorValue, isComplete }], []];
      if (sql.includes('SELECT sourceHash')) return [[], []];
      if (sql.includes('SELECT id FROM profile_snapshots')) return [[{ id: 'mysql-profile-1' }], []];
      if (sql.includes('UPDATE profile_migration_cursors')) {
        [cursorValue, isComplete] = params as [string | null, boolean];
      }
      return [{ affectedRows: 1 }, []];
    });
    const pool = { query };
    const convex = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ items: [snapshot], cursor: 'cursor-2', done: false })
        .mockResolvedValueOnce({ items: [{ ...snapshot, legacyConvexId: 'users:2' }], cursor: null, done: true }),
    };

    await expect(
      runProfileBackfillToCompletion({ pool: pool as never, convex: convex as never, batchId: 'batch-1', batchSize: 10 }),
    ).resolves.toEqual({ batchId: 'batch-1', upserted: 2, unchanged: 0, done: true });
    expect(convex.query).toHaveBeenNthCalledWith(1, expect.anything(), { cursor: undefined, limit: 10 });
    expect(convex.query).toHaveBeenNthCalledWith(2, expect.anything(), { cursor: 'cursor-2', limit: 10 });
  });

  it('records a failure without advancing the cursor', async () => {
    const pool = poolFor();
    const convex = { query: vi.fn(async () => { throw new Error('Convex unavailable'); }) };

    await expect(
      runProfileBackfill({ pool: pool as never, convex: convex as never, batchId: 'batch-1', batchSize: 10 }),
    ).rejects.toThrow('Convex unavailable');
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes("SET status = 'failed'"))).toBe(true);
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE profile_migration_cursors'))).toBe(false);
  });
});