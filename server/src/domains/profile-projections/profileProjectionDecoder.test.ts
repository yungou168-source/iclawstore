import { describe, expect, it } from 'vitest';
import {
  decodeAndSortProfileProjectionCatalogItems,
  decodeProfileProjectionCatalogItem,
  type ProfileProjectionSourceCatalogItem,
} from './profileProjectionDecoder';

const sourceItem = (
  overrides: Partial<ProfileProjectionSourceCatalogItem> = {},
): ProfileProjectionSourceCatalogItem => ({
  legacyConvexId: 'skills:example',
  kind: 'skill',
  slug: 'example',
  displayName: 'Example Skill',
  summary: null,
  icon: null,
  href: '/owner/example',
  canonicalStats: { downloads: 10, stars: 2 },
  isOfficial: false,
  updatedAt: 100,
  ...overrides,
});

describe('profile projection catalog decoder', () => {
  it('preserves canonical stats and normalizes optional source fields', () => {
    const decoded = decodeProfileProjectionCatalogItem(
      sourceItem({
        summary: undefined,
        icon: undefined,
        sourceGitHubId: undefined,
        sourceRepo: 'ignored/repository',
      }),
    );

    expect(decoded).toMatchObject({
      _id: 'skills:example',
      legacyConvexId: 'skills:example',
      summary: null,
      icon: null,
      downloads: 10,
      stars: 2,
      sourceBacked: false,
      sourceGitHubId: null,
      sourceRepo: null,
      sourcePath: null,
      sourceVerifiedCommit: null,
    });
  });

  it('retains GitHub source identity only for source-backed skills', () => {
    const decoded = decodeProfileProjectionCatalogItem(
      sourceItem({
        sourceGitHubId: 'githubSkillSources:example',
        sourceRepo: 'owner/repository',
        sourcePath: 'skills/example',
        sourceVerifiedCommit: 'abc123',
      }),
    );

    expect(decoded).toMatchObject({
      sourceBacked: true,
      sourceGitHubId: 'githubSkillSources:example',
      sourceRepo: 'owner/repository',
      sourcePath: 'skills/example',
      sourceVerifiedCommit: 'abc123',
    });
  });

  it('uses the existing stable downloads and recent ordering semantics', () => {
    const items = [
      sourceItem({ legacyConvexId: 'skills:alpha', displayName: 'Alpha', updatedAt: 5 }),
      sourceItem({
        legacyConvexId: 'packages:beta',
        kind: 'plugin',
        displayName: 'Beta',
        canonicalStats: { downloads: 10, stars: 3 },
        updatedAt: 4,
      }),
      sourceItem({
        legacyConvexId: 'skills:gamma',
        displayName: 'Gamma',
        canonicalStats: { downloads: 1, stars: 0 },
        updatedAt: 6,
      }),
    ];

    expect(
      decodeAndSortProfileProjectionCatalogItems(items).map((item) => item.legacyConvexId),
    ).toEqual(['packages:beta', 'skills:alpha', 'skills:gamma']);
    expect(
      decodeAndSortProfileProjectionCatalogItems(items, 'recent').map((item) => item.legacyConvexId),
    ).toEqual(['skills:gamma', 'skills:alpha', 'packages:beta']);
  });
});