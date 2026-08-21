import type {
  SkillPackageAggregateSnapshot,
  SkillPackageArtifactSnapshot,
  SkillPackageVersionFileFact,
  SkillPackageVersionSnapshot,
} from './skillPackageMigrationPort.js';

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

const compareArtifacts = (
  left: SkillPackageArtifactSnapshot,
  right: SkillPackageArtifactSnapshot,
) => left.path.localeCompare(right.path) || left.sha256.localeCompare(right.sha256);

const normalizeArtifact = (artifact: SkillPackageArtifactSnapshot): SkillPackageArtifactSnapshot => ({
  legacyStorageId: artifact.legacyStorageId,
  path: artifact.path.replaceAll('\\', '/'),
  mimeType: artifact.mimeType.toLowerCase(),
  sizeBytes: artifact.sizeBytes,
  sha256: artifact.sha256.toLowerCase(),
});

const normalizeFileMetadata = (file: SkillPackageVersionFileFact): SkillPackageVersionFileFact => ({
  path: file.path.replaceAll('\\\\', '/'),
  sizeBytes: file.sizeBytes,
  mimeType: file.mimeType.toLowerCase(),
  sha256: file.sha256.toLowerCase(),
  storageLegacyConvexId: file.storageLegacyConvexId,
});

const normalizeVersion = (version: SkillPackageVersionSnapshot): SkillPackageVersionSnapshot => ({
  ...version,
  semanticVersion: version.semanticVersion.trim(),
  sourceMetadata: JSON.parse(stableValue(version.sourceMetadata)) as Record<string, unknown>,
  scanSnapshot: version.scanSnapshot
    ? JSON.parse(stableValue(version.scanSnapshot)) as Record<string, unknown>
    : null,
  fileMetadata: version.fileMetadata?.map(normalizeFileMetadata).sort((left, right) =>
    left.path.localeCompare(right.path) || left.sha256.localeCompare(right.sha256)),
  artifacts: version.artifacts.map(normalizeArtifact).sort(compareArtifacts),
});

export const normalizeSkillPackageAggregate = (
  aggregate: SkillPackageAggregateSnapshot,
): SkillPackageAggregateSnapshot => ({
  ...aggregate,
  canonicalName: aggregate.canonicalName.trim().toLowerCase(),
  displayName: aggregate.displayName.trim(),
  summary: aggregate.summary?.trim() || null,
  metadata: JSON.parse(stableValue(aggregate.metadata)) as Record<string, unknown>,
  versions: aggregate.versions
    .map(normalizeVersion)
    .sort((left, right) => left.semanticVersion.localeCompare(right.semanticVersion)),
});

export const stableSkillPackageValue = (value: unknown): string => stableValue(value);

export const stableSkillPackageAggregate = (aggregate: SkillPackageAggregateSnapshot): string =>
  stableValue(normalizeSkillPackageAggregate(aggregate));