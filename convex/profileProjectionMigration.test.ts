import { describe, expect, it, vi } from 'vitest';
import {
  decodeProfileProjectionSourceCursor,
  listManifestSnapshotPageInternal,
  listStarredSnapshotPageInternal,
} from './profileProjectionMigration';

describe('profile projection migration cursor', () => {
  it('accepts a cursor only for its declared phase', () => {
    expect(
      decodeProfileProjectionSourceCursor(JSON.stringify({ phase: 'skills', cursor: 'opaque' }), 'skills'),
    ).toEqual({ phase: 'skills', cursor: 'opaque' });
  });

  it('fails closed for malformed or cross-phase cursors', () => {
    expect(() => decodeProfileProjectionSourceCursor('{', 'skills')).toThrow(
      'Profile projection source cursor is invalid',
    );
    expect(() =>
      decodeProfileProjectionSourceCursor(JSON.stringify({ phase: 'stars', cursor: null }), 'skills'),
    ).toThrow('Profile projection source cursor is invalid');
  });

  it('keeps the star viewer separate from the starred Skill owner', async () => {
    const star = { userId: 'users:viewer', skillId: 'skills:other-owner', createdAt: 123 };
    const paginate = vi.fn().mockResolvedValue({
      page: [star],
      isDone: false,
      continueCursor: 'next-star-page',
    });
    const query = vi.fn((table: string) => {
      if (table === 'stars') {
        return { withIndex: vi.fn(() => ({ order: vi.fn(() => ({ paginate })) })) };
      }
      if (table === 'officialPublishers') {
        return { withIndex: vi.fn(() => ({ unique: vi.fn().mockResolvedValue(null) })) };
      }
      throw new Error(`Unexpected table ${table}`);
    });
    const get = vi.fn(async (id: string) => {
      if (id === 'users:viewer') return { _id: id };
      if (id === 'skills:other-owner') {
        return {
          _id: id,
          ownerPublisherId: 'publishers:other-owner',
          slug: 'foreign-skill',
          displayName: 'Foreign Skill',
          summary: undefined,
          icon: undefined,
          statsDownloads: 11,
          statsStars: 7,
          stats: { downloads: 0, stars: 0 },
          badges: undefined,
          updatedAt: 456,
          softDeletedAt: undefined,
          moderationStatus: 'active',
        };
      }
      if (id === 'publishers:other-owner') {
        return { _id: id, kind: 'org', handle: 'other-owner' };
      }
      return null;
    });

    const result = await (listStarredSnapshotPageInternal as never as {
      _handler: (ctx: unknown, args: { cursor?: string; limit?: number }) => Promise<unknown>;
    })._handler({ db: { get, query, normalizeId: vi.fn() } }, { limit: 10 });

    expect(paginate).toHaveBeenCalledWith({ cursor: null, numItems: 10 });
    expect(result).toEqual({
      items: [
        {
          viewerUserLegacyConvexId: 'users:viewer',
          starredAt: 123,
          item: expect.objectContaining({
            legacyConvexId: 'skills:other-owner',
            href: '/other-owner/foreign-skill',
            canonicalStats: { downloads: 11, stars: 7 },
          }),
        },
      ],
      cursor: JSON.stringify({ phase: 'stars', cursor: 'next-star-page' }),
      done: false,
    });
  });

  it('keeps manifest section and entry ordering in its source boundary', async () => {
    const paginate = vi.fn().mockResolvedValue({
      page: [
        {
          _id: 'githubSkillSources:source',
          ownerPublisherId: 'publishers:owner',
          repo: 'acme/catalog',
          displayManifestStatus: 'ok',
          displayManifestCommit: 'commit-1',
          displayManifest: {
            notGrouped: 'top',
            groupings: [
              { title: 'Featured', description: undefined, skills: ['first', 'second'] },
            ],
          },
          updatedAt: 789,
        },
      ],
      isDone: true,
      continueCursor: '',
    });
    const query = vi.fn((table: string) => {
      if (table === 'githubSkillSources') {
        return { withIndex: vi.fn(() => ({ order: vi.fn(() => ({ paginate })) })) };
      }
      throw new Error(`Unexpected table ${table}`);
    });
    const get = vi.fn(async (id: string) =>
      id === 'publishers:owner' ? { _id: id, kind: 'org', handle: 'owner' } : null,
    );

    const result = await (listManifestSnapshotPageInternal as never as {
      _handler: (ctx: unknown, args: { cursor?: string; limit?: number }) => Promise<unknown>;
    })._handler({ db: { get, query, normalizeId: vi.fn() } }, { limit: 10 });

    expect(result).toEqual({
      items: [
        {
          sourceGitHubLegacyConvexId: 'githubSkillSources:source',
          publisherLegacyConvexId: 'publishers:owner',
          repo: 'acme/catalog',
          status: 'ok',
          verifiedCommit: 'commit-1',
          notGrouped: 'top',
          updatedAt: 789,
          sections: [
            {
              position: 0,
              title: 'Featured',
              description: null,
              entries: [
                { position: 0, skillKey: 'first' },
                { position: 1, skillKey: 'second' },
              ],
            },
          ],
        },
      ],
      cursor: null,
      done: true,
    });
  });
});