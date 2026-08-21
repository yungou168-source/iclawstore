import type { SoulFileSnapshot, SoulSnapshot, SoulVersionSnapshot } from './soulMigrationDto.js';

const stableValue = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableValue(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const normalizeFile = (file: SoulFileSnapshot): SoulFileSnapshot => ({
  ...file,
  path: file.path.replaceAll('\\', '/'),
  mimeType: file.mimeType?.toLowerCase() ?? null,
  sha256: file.sha256.toLowerCase(),
});

const normalizeVersion = (version: SoulVersionSnapshot): SoulVersionSnapshot => ({
  ...version,
  semanticVersion: version.semanticVersion.trim(),
  fingerprint: version.fingerprint?.toLowerCase() ?? null,
  changelog: version.changelog.trim(),
  changelogSource: version.changelogSource?.trim().toLowerCase() ?? null,
  parsedMetadata: JSON.parse(stableValue(version.parsedMetadata)) as Record<string, unknown>,
  sourceHash: version.sourceHash.toLowerCase(),
  files: version.files
    .map(normalizeFile)
    .sort((left, right) => left.path.localeCompare(right.path) || left.sha256.localeCompare(right.sha256)),
});

export const normalizeSoulSnapshot = (snapshot: SoulSnapshot): SoulSnapshot => ({
  ...snapshot,
  slug: snapshot.slug.trim().toLowerCase(),
  displayName: snapshot.displayName.trim(),
  summary: snapshot.summary?.trim() || null,
  tags: JSON.parse(stableValue(snapshot.tags)) as Record<string, string>,
  stats: JSON.parse(stableValue(snapshot.stats)) as Record<string, number>,
  sourceHash: snapshot.sourceHash.toLowerCase(),
  versions: snapshot.versions
    .map(normalizeVersion)
    .sort((left, right) => left.semanticVersion.localeCompare(right.semanticVersion) || left.legacyConvexId.localeCompare(right.legacyConvexId)),
});

export const stableSoulValue = (value: unknown): string => stableValue(value);

export const stableSoulSnapshot = (snapshot: SoulSnapshot): string =>
  stableValue(normalizeSoulSnapshot(snapshot));