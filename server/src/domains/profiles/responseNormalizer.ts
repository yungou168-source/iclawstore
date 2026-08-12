import type { PublicProfile } from './publicProfilePort.js';

export type ProfileComparisonValue = Readonly<{
  stableId: string;
  profile: PublicProfile | null;
}>;

const normalizedText = (value: string | undefined | null): string | null => {
  const normalized = value?.trim().replace(/\s+/g, ' ');
  return normalized ? normalized : null;
};

const normalizedSlug = (value: string | undefined | null): string | null =>
  normalizedText(value)?.toLowerCase() ?? null;

const normalizedProfile = (profile: PublicProfile | null) =>
  profile
    ? {
        stableId: profile.user._id,
        profileSlug: normalizedSlug(profile.profileSlug),
        handle: normalizedSlug(profile.user.handle),
        name: normalizedText(profile.user.name),
        displayName: normalizedText(profile.user.displayName),
        bio: normalizedText(profile.user.bio),
        imagePresent: Boolean(normalizedText(profile.user.image)),
        creationTime: profile.user._creationTime,
        publisherHandle: normalizedSlug(profile.publisher?.handle),
        publisherDisplayName: normalizedText(profile.publisher?.displayName),
      }
    : null;

export type ProfileDifference = Readonly<{
  stableId: string;
  fieldName: string;
  differenceKind: 'missing' | 'value_mismatch';
  summary: string;
}>;

export const compareNormalizedProfiles = (
  convex: ProfileComparisonValue,
  mysql: ProfileComparisonValue,
): ProfileDifference[] => {
  const source = normalizedProfile(convex.profile);
  const target = normalizedProfile(mysql.profile);
  const stableId = convex.stableId;
  if (!source && !target) return [];
  if (!target) {
    return [
      {
        stableId,
        fieldName: 'profile',
        differenceKind: 'missing',
        summary: 'mysql profile is absent',
      },
    ];
  }
  if (!source) return [];

  const differences: ProfileDifference[] = [];
  for (const key of Object.keys(source) as Array<keyof typeof source>) {
    if (key === 'stableId') continue;
    if (source[key] !== target[key]) {
      differences.push({
        stableId,
        fieldName: key,
        differenceKind: 'value_mismatch',
        summary: `normalized ${key} differs`,
      });
    }
  }
  return differences;
};