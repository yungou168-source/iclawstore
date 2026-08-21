import { describe, expect, it } from 'bun:test';
import { createProfileProjectionReconciliationTarget } from '../src/domains/profile-projections/profileProjectionReconciliationTargetRepository.js';

const source = [{
  publisherLegacyConvexId: 'publishers:one', publisherHandle: 'one',
  item: { legacyConvexId: 'skills:one', kind: 'skill' as const, displayName: 'One', href: '/one/one', canonicalStats: { downloads: 1, stars: 2 }, isOfficial: false, updatedAt: 1 },
}];

describe('profile projection reconciliation target repository', () => {
  it('rehydrates catalog snapshots from the persisted source fields', async () => {
    const target = createProfileProjectionReconciliationTarget({
      query: async () => [[{
        publisherLegacyConvexId: 'publishers:one', publisherHandle: 'one', legacyConvexId: 'skills:one',
        kind: 'skill', slug: 'one', displayName: 'One', summary: null, icon: null, sourceHref: '/one/one',
        downloads: 1, stars: 2, isOfficial: 0, legacyUpdatedAt: new Date(1), sourceGitHubId: null, sourcePath: null,
      }], []],
    });
    expect(await target.list('catalog', source)).toEqual([{ ...source[0], item: { ...source[0].item, slug: 'one', summary: null, icon: null, sourceGitHubId: null, sourcePath: null } }]);
  });
});