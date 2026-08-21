import { describe, expect, it } from 'bun:test';
import { createMysqlProfileProjectionReadPort } from '../src/domains/profile-projections/profileProjectionReadPortFactory.js';

const item = {
  legacyConvexId: 'skills:one', kind: 'skill' as const, displayName: 'One', summary: null, icon: null,
  sourceHref: '/acme/one', ownerHandle: 'acme', downloads: 1, stars: 2, isOfficial: 0,
  legacyUpdatedAt: new Date(1), sourceGitHubId: 'github:one', sourceRepo: 'acme/skills',
  sourcePath: 'skills/one', sourceVerifiedCommit: 'commit',
};

describe('MySQL profile projection manifest display', () => {
  it('restores grouped sections and places ungrouped skills at the requested manifest position', async () => {
    let queryCount = 0;
    const port = createMysqlProfileProjectionReadPort({
      query: async () => {
        queryCount += 1;
        return queryCount === 1
          ? [[{
            ...item, manifestId: 'manifest-1', manifestLegacyId: 'github:one', manifestRepo: 'acme/skills',
            notGrouped: 'top', sectionId: 'section-1', sectionPosition: 0, sectionTitle: 'Featured',
            sectionDescription: null, entryPosition: 0,
          }], []]
          : [[{ ...item, legacyConvexId: 'skills:other', displayName: 'Other', sourceGitHubId: null }], []];
      },
    } as never);
    expect(await port.getCatalogDisplay({ handle: 'acme', sort: 'downloads' })).toEqual({
      mode: 'grouped', sourceRepos: ['acme/skills'], sections: [
        expect.objectContaining({ key: 'other-skills', items: [expect.objectContaining({ _id: 'skills:other' })] }),
        expect.objectContaining({ title: 'Featured', items: [expect.objectContaining({ _id: 'skills:one' })] }),
      ],
    });
  });

  it('returns null when no valid manifest exists', async () => {
    const port = createMysqlProfileProjectionReadPort({ query: async () => [[], []] } as never);
    expect(await port.getCatalogDisplay({ handle: 'acme', sort: 'downloads' })).toBeNull();
  });
});