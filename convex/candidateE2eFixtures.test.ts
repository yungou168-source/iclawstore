import { describe, expect, it, vi } from 'vitest';

vi.mock('./functions', async () => {
  const actual = await vi.importActual<typeof import('./functions')>('./functions');
  const exposeHandler = <T extends { handler: unknown }>(definition: T) => ({
    ...definition,
    _handler: definition.handler,
  });
  return {
    ...actual,
    action: (definition: unknown) => definition,
    internalMutation: exposeHandler,
    internalQuery: exposeHandler,
  };
});

import { cleanupLegacyStaticProfile } from './candidateE2eFixtures.js';

type WrappedHandler = (
  ctx: {
    db: {
      query: (table: string) => unknown;
      get: ReturnType<typeof vi.fn>;
      insert: ReturnType<typeof vi.fn>;
      patch: ReturnType<typeof vi.fn>;
      replace: ReturnType<typeof vi.fn>;
      delete: (id: string) => Promise<void>;
      normalizeId: ReturnType<typeof vi.fn>;
    };
  },
  args: { confirmation: string },
) => Promise<unknown>;

const cleanupLegacyStaticProfileHandler = (
  cleanupLegacyStaticProfile as unknown as { _handler: WrappedHandler }
)._handler;

const fixtureUser = {
  _id: 'users:candidate',
  handle: 'candidate-e2e-user',
  bio: 'candidate-e2e-fixture: safe to delete',
  imageStorageId: 'storage:user-avatar',
};

const fixturePublisher = {
  _id: 'publishers:candidate',
  handle: 'candidate-e2e-user',
  bio: 'candidate-e2e-fixture: safe to delete',
};

const queryResult = (result: unknown) => ({
  withIndex: () => ({
    unique: async () => result,
    collect: async () => result,
  }),
});

describe('cleanupLegacyStaticProfile', () => {
  it('removes personal Publisher relations before deleting the legacy fixture Publisher', async () => {
    const deleted: string[] = [];
    const orphanMember = {
      _id: 'publisherMembers:orphan',
      publisherId: 'publishers:missing',
    };
    const ctx = {
      db: {
        query: (table: string) => {
          if (table === 'users') return queryResult(fixtureUser);
          if (table === 'publishers') {
            return {
              withIndex: (index: string) => ({
                unique: async () => (index === 'by_handle' ? fixturePublisher : null),
                collect: async () => [],
              }),
            };
          }
          if (table === 'profileIdentityAliases') return queryResult([]);
          if (table === 'publisherMembers') return queryResult([]);
          if (table === 'officialPublishers') {
            return queryResult([{ _id: 'officialPublishers:orphan' }]);
          }
          throw new Error(`Unexpected table ${table}`);
        },
        get: vi.fn(async (id: string) => {
          if (id === 'q972bnrgasvzypr43w37kvs9t98cqrpc') return orphanMember;
          if (id === 'publishers:candidate') return fixturePublisher;
          if (id === 'users:candidate') return fixtureUser;
          if (id === 'officialPublishers:orphan') return { _id: id };
          return null;
        }),
        insert: vi.fn(async () => 'unused'),
        patch: vi.fn(async () => undefined),
        replace: vi.fn(async () => undefined),
        delete: vi.fn(async (id: string) => {
          deleted.push(id);
        }),
        normalizeId: vi.fn((_: string, id: string) => id),
      },
    };

    await expect(
      cleanupLegacyStaticProfileHandler(ctx, { confirmation: 'candidate-e2e-fixtures' }),
    ).resolves.toEqual({ storageIds: ['storage:user-avatar'] });

    expect(deleted).toEqual(expect.arrayContaining([
      'publisherMembers:orphan',
      'officialPublishers:orphan',
      'publishers:candidate',
      'users:candidate',
    ]));
  });
});