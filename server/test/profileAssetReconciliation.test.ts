import { Readable } from 'node:stream';
import { describe, expect, it, mock } from 'bun:test';
import { createProfileAvatarAssetImporter } from '../src/domains/profiles/profileAvatarAssetImport.js';
import {
  reconcileProfileAvatarAsset,
  reconcileProfileAliases,
  reconcileProfileCanonicalAliases,
  reconcileProfileSnapshots,
} from '../src/domains/profiles/profileReconciliation.js';
import { reconcileProfilePage, runProfileReconciliation } from '../src/domains/profiles/profileReconciliationRunner.js';

describe('profile asset and reconciliation foundation', () => {
  it('does not copy an avatar that is already active', async () => {
    const existing = {
      assetId: 'asset-1',
      legacyStorageId: 'storage:avatar',
      ownerLegacyConvexId: 'users:1',
      accessScope: 'public' as const,
      storageKey: 'avatar/aa/00000000-0000-0000-0000-000000000000.png',
      originalFileName: 'avatar.png',
      mimeType: 'image/png',
      sizeBytes: 4,
      sha256: 'a'.repeat(64),
      status: 'active' as const,
    };
    const store = { store: mock() };
    const repository = { findByLegacyStorageId: mock(async () => existing), save: mock(async () => undefined) };
    const importer = createProfileAvatarAssetImporter(store as never, repository);

    await expect(importer.import({
      ownerLegacyConvexId: 'users:1',
      source: {
        legacyStorageId: 'storage:avatar',
        originalFileName: 'avatar.png',
        declaredMimeType: 'image/png',
        stream: Readable.from([Buffer.from('test')]),
      },
    })).resolves.toEqual(existing);
    expect(store.store).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('classifies state, alias, relation, and avatar hash mismatches', () => {
    const differences = reconcileProfileSnapshots(
      {
        legacyConvexId: 'users:1', handle: 'alice', profileSlug: 'alice', personalPublisherLegacyConvexId: 'publishers:1',
        deletedAt: null, deactivatedAt: null, purgedAt: null, banReason: 'spam', imageStorageId: 'storage:1',
      },
      {
        legacyConvexId: 'users:1', handle: 'alice-renamed', profileSlug: 'alice', personalPublisherLegacyConvexId: null,
        deletedAt: null, deactivatedAt: 1, purgedAt: null, banReason: null, imageStorageId: 'storage:1',
      },
    );
    expect(differences.map((difference) => difference.fieldName)).toEqual([
      'handle', 'personalPublisherLegacyConvexId', 'deactivatedAt', 'banReason',
    ]);
    expect(reconcileProfileCanonicalAliases(
      { legacyConvexId: 'users:1', profileSlug: 'alice', handle: 'alice' },
      [{ aliasKind: 'profile_slug', aliasValue: 'alice', isCanonical: true }],
    )).toEqual([{
      legacyConvexId: 'users:1', fieldName: 'aliases.user_handle', differenceKind: 'missing',
      summary: 'canonical user_handle alias is absent',
    }]);
    expect(reconcileProfileAvatarAsset(
      'users:1', 'storage:1', { mimeType: 'image/png', sizeBytes: 4, sha256: 'a'.repeat(64) },
      { legacyStorageId: 'storage:1', mimeType: 'image/png', sizeBytes: 4, sha256: 'b'.repeat(64), status: 'active' },
    )).toEqual([{
      legacyConvexId: 'users:1', fieldName: 'avatar.sha256', differenceKind: 'value_mismatch', summary: 'avatar sha256 differs',
    }]);
  });

  it('records a page only after aliases, relation, avatar metadata, and target presence are compared', async () => {
    const records: unknown[] = [];
    const sourceProfile = {
      legacyConvexId: 'users:1', handle: 'alice', profileSlug: 'alice', personalPublisherLegacyConvexId: 'publishers:1',
      deletedAt: null, deactivatedAt: null, purgedAt: null, banReason: null, imageStorageId: 'storage:1',
    };
    const summary = await reconcileProfilePage({
      batchId: 'batch-page-1',
      profiles: [sourceProfile],
      source: { avatarMetadata: mock(async () => ({ mimeType: 'image/png', sizeBytes: 4, sha256: 'a'.repeat(64) })) },
      target: {
        findProfile: mock(async () => ({ ...sourceProfile, personalPublisherLegacyConvexId: null })),
        listAliases: mock(async () => [{ aliasKind: 'profile_slug' as const, aliasValue: 'alice', isCanonical: true }]),
        findAvatar: mock(async () => ({ legacyStorageId: 'storage:1', mimeType: 'image/png', sizeBytes: 4, sha256: 'b'.repeat(64), status: 'active' as const })),
      },
      sink: { record: mock(async (record) => { records.push(record); }) },
    });
    expect(summary).toMatchObject({ sourceProfiles: 1, comparedProfiles: 1, differences: 3 });
    expect(records).toHaveLength(3);
  });

  it('compares historical aliases, retiredAt, and target-only aliases', () => {
    const differences = reconcileProfileAliases(
      {
        legacyConvexId: 'users:history',
        handle: 'new-handle',
        profileSlug: 'new-slug',
        aliases: [
          { aliasKind: 'user_handle', aliasValue: 'old-handle', isCanonical: false, retiredAt: 123 },
          { aliasKind: 'profile_slug', aliasValue: 'new-slug', isCanonical: true, retiredAt: null },
          { aliasKind: 'user_handle', aliasValue: 'new-handle', isCanonical: true, retiredAt: null },
        ],
      },
      [
        { aliasKind: 'user_handle', aliasValue: 'old-handle', isCanonical: false, retiredAt: 456 },
        { aliasKind: 'profile_slug', aliasValue: 'new-slug', isCanonical: true, retiredAt: null },
        { aliasKind: 'user_handle', aliasValue: 'new-handle', isCanonical: true, retiredAt: null },
        { aliasKind: 'profile_slug', aliasValue: 'orphaned', isCanonical: false, retiredAt: 789 },
      ],
    );
    expect(differences).toEqual([
      {
        legacyConvexId: 'users:history',
        fieldName: 'aliases.user_handle.old-handle',
        differenceKind: 'value_mismatch',
        summary: 'alias canonical or retirement state differs',
      },
      {
        legacyConvexId: 'users:history',
        fieldName: 'aliases.profile_slug.orphaned',
        differenceKind: 'missing',
        summary: 'target contains an extra alias',
      },
    ]);
  });

  it('produces a fail-closed candidate summary for unclassified differences', async () => {
    const sourceProfile = {
      legacyConvexId: 'users:1', handle: 'alice', profileSlug: 'alice', personalPublisherLegacyConvexId: null,
      deletedAt: null, deactivatedAt: null, purgedAt: null, banReason: null, imageStorageId: null,
    };
    const records: unknown[] = [];
    const summary = await runProfileReconciliation({
      batchId: 'batch-1',
      source: {
        profiles: async function* () { yield sourceProfile; },
        avatarMetadata: mock(async () => null),
      },
      target: {
        findProfile: mock(async () => ({ ...sourceProfile, handle: 'alice-renamed' })),
        listLegacyConvexIds: mock(async () => ['users:1', 'users:orphan']),
        listAliases: mock(async () => [
          { aliasKind: 'profile_slug' as const, aliasValue: 'alice', isCanonical: true },
          { aliasKind: 'user_handle' as const, aliasValue: 'alice', isCanonical: true },
        ]),
        findAvatar: mock(async () => null),
      },
      sink: { record: mock(async (record) => { records.push(record); }) },
    });

    expect(summary).toEqual({
      batchId: 'batch-1', sourceProfiles: 1, targetProfiles: 2, comparedProfiles: 1,
      differences: 2, unclassifiedDifferences: 2, candidateReady: false,
    });
    expect(records).toHaveLength(2);
  });
});
