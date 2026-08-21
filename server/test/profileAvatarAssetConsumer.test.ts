import { describe, expect, it, vi } from 'bun:test';
import { createProfileAvatarAssetConsumer } from '../src/domains/profiles/profileAvatarAssetConsumer.js';

const eventRow = {
  id: 'event-1',
  aggregateId: 'users:1',
  payload: {
    legacyConvexId: 'users:1',
    sourceStorageId: 'storage:avatar',
    profileId: 'profile-1',
  },
  attempts: 0,
};

const connection = (selectRows: unknown[] = []) => ({
  beginTransaction: vi.fn(async () => undefined),
  commit: vi.fn(async () => undefined),
  rollback: vi.fn(async () => undefined),
  release: vi.fn(),
  query: vi.fn(async (sql: string) =>
    sql.includes('SELECT id, aggregateId') ? [selectRows, []] : [{ affectedRows: 1 }, []],
  ),
});

describe('Profile avatar asset consumer', () => {
  it('claims, imports, and publishes an avatar event idempotently', async () => {
    const claimConnection = connection([eventRow]);
    const publishConnection = connection();
    const pool = {
      getConnection: vi.fn()
        .mockResolvedValueOnce(claimConnection)
        .mockResolvedValueOnce(publishConnection),
      query: vi.fn(),
    };
    const source = {
      legacyStorageId: 'storage:avatar',
      originalFileName: 'profile-avatar.png',
      declaredMimeType: 'image/png',
      stream: {} as never,
    };
    const sourceReader = { read: vi.fn(async () => source) };
    const asset = {
      assetId: 'asset-1',
      legacyStorageId: 'storage:avatar',
      ownerLegacyConvexId: 'users:1',
      accessScope: 'public' as const,
      storageKey: 'avatar/aa/00000000-0000-0000-0000-000000000000.png',
      originalFileName: 'profile-avatar.png',
      mimeType: 'image/png',
      sizeBytes: 4,
      sha256: 'a'.repeat(64),
      status: 'active' as const,
    };
    const importer = { import: vi.fn(async () => asset) };
    const consumer = createProfileAvatarAssetConsumer({
      pool: pool as never,
      sourceReader,
      importer,
    });

    await expect(consumer.consumeNext()).resolves.toEqual({
      kind: 'imported',
      eventId: 'event-1',
      assetId: 'asset-1',
    });
    expect(sourceReader.read).toHaveBeenCalledWith('storage:avatar');
    expect(importer.import).toHaveBeenCalledTimes(1);
    expect(
      publishConnection.query.mock.calls.some(([sql]) =>
        String(sql).includes("status = 'published'")),
    ).toBe(true);
  });

  it('does not let an expired lease write avatar metadata after reclamation', async () => {
    const claimConnection = connection([eventRow]);
    const publicationConnection = connection();
    publicationConnection.query.mockImplementation(async (sql: string) =>
      sql.includes("status = 'published'") ? [{ affectedRows: 0 }, []] : [{ affectedRows: 1 }, []],
    );
    const pool = {
      getConnection: vi.fn()
        .mockResolvedValueOnce(claimConnection)
        .mockResolvedValueOnce(publicationConnection),
      query: vi.fn(),
    };
    const consumer = createProfileAvatarAssetConsumer({
      pool: pool as never,
      sourceReader: {
        read: vi.fn(async () => ({
          legacyStorageId: 'storage:avatar',
          originalFileName: 'profile-avatar.png',
          declaredMimeType: 'image/png',
          stream: {} as never,
        })),
      },
      importer: {
        import: vi.fn(async () => ({
          assetId: 'asset-1',
          legacyStorageId: 'storage:avatar',
          ownerLegacyConvexId: 'users:1',
          accessScope: 'public' as const,
          storageKey: 'avatar/aa/00000000-0000-0000-0000-000000000000.png',
          originalFileName: 'profile-avatar.png',
          mimeType: 'image/png',
          sizeBytes: 4,
          sha256: 'a'.repeat(64),
          status: 'active' as const,
        })),
      },
    });

    await expect(consumer.consumeNext()).resolves.toEqual({
      kind: 'lost', eventId: 'event-1', reason: 'profile_avatar_lease_lost',
    });
    expect(
      publicationConnection.query.mock.calls.some(([sql]) =>
        String(sql).includes('UPDATE profile_asset_snapshots')),
    ).toBe(false);
  });

  it('returns an expired lease to the retry queue with a failure code', async () => {
    const claimConnection = connection([eventRow]);
    const pool = {
      getConnection: vi.fn(async () => claimConnection),
      query: vi.fn(async () => [{ affectedRows: 1 }, []]),
    };
    const consumer = createProfileAvatarAssetConsumer({
      pool: pool as never,
      sourceReader: { read: vi.fn(async () => null) },
      importer: { import: vi.fn() },
    });

    await expect(consumer.consumeNext()).resolves.toMatchObject({
      kind: 'failed',
      eventId: 'event-1',
      terminal: false,
      failureCode: 'profile_avatar_source_missing',
    });
    expect(
      pool.query.mock.calls.some(([sql, params]) =>
        String(sql).includes('UPDATE convex_exit_outbox_events') &&
        Array.isArray(params) &&
        params[0] === 'pending'),
    ).toBe(true);
  });
});