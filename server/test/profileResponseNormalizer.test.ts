import { describe, expect, it } from 'bun:test';
import { compareNormalizedProfiles } from '../src/domains/profiles/responseNormalizer.js';

const profile = {
  user: {
    _id: 'users:stable',
    _creationTime: 1,
    handle: 'Alice',
    displayName: ' Alice  Example ',
    image: 'https://signed.example/avatar',
  },
  profileSlug: 'Alice',
  publisher: null,
} as const;

describe('profile response normalizer', () => {
  it('ignores equivalent whitespace and slug casing without retaining resource URLs', () => {
    const target = {
      ...profile,
      user: { ...profile.user, handle: 'alice', displayName: 'Alice Example', image: 'other-url' },
      profileSlug: 'alice',
    };
    expect(
      compareNormalizedProfiles(
        { stableId: profile.user._id, profile },
        { stableId: profile.user._id, profile: target },
      ),
    ).toEqual([]);
  });

  it('records only stable field summaries for mismatches', () => {
    const target = { ...profile, user: { ...profile.user, displayName: 'Other' } };
    expect(
      compareNormalizedProfiles(
        { stableId: profile.user._id, profile },
        { stableId: profile.user._id, profile: target },
      ),
    ).toEqual([
      {
        stableId: 'users:stable',
        fieldName: 'displayName',
        differenceKind: 'value_mismatch',
        summary: 'normalized displayName differs',
      },
    ]);
  });
});