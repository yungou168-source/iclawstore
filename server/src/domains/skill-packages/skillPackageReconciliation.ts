import type {
  SkillPackageAggregateSnapshot,
  SkillPackageArtifactSnapshot,
  SkillPackageFacts,
  SkillPackageVersionSnapshot,
} from './skillPackageMigrationPort.js';
import {
  normalizeSkillPackageAggregate,
  stableSkillPackageAggregate,
  stableSkillPackageValue,
} from './skillPackageNormalizer.js';

export type SkillPackageReconciliationDifference = Readonly<{
  legacyConvexId: string;
  fieldName: 'aggregate' | 'version' | 'artifact' | 'owner' | 'source' | 'scan';
  differenceKind: 'missing' | 'value_mismatch' | 'orphan';
  classification: 'unclassified';
  summary: string;
}>;

const artifactKey = (artifact: SkillPackageArtifactSnapshot) =>
  `${artifact.path}:${artifact.sha256}`;

const compareVersion = (
  id: string,
  source: SkillPackageVersionSnapshot,
  target?: SkillPackageVersionSnapshot,
): SkillPackageReconciliationDifference[] => {
  if (!target) {
    return [
      {
        legacyConvexId: source.legacyConvexId,
        fieldName: 'version',
        differenceKind: 'missing',
        classification: 'unclassified',
        summary: `${id} version is absent from target`,
      },
    ];
  }

  const out: SkillPackageReconciliationDifference[] = [];
  if (source.semanticVersion !== target.semanticVersion || source.sourceHash !== target.sourceHash) {
    out.push({
      legacyConvexId: source.legacyConvexId,
      fieldName: 'version',
      differenceKind: 'value_mismatch',
      classification: 'unclassified',
      summary: 'semantic version or source hash differs',
    });
  }
  if (stableSkillPackageValue(source.sourceMetadata) !== stableSkillPackageValue(target.sourceMetadata)) {
    out.push({
      legacyConvexId: source.legacyConvexId,
      fieldName: 'source',
      differenceKind: 'value_mismatch',
      classification: 'unclassified',
      summary: 'source metadata differs',
    });
  }
  if (stableSkillPackageValue(source.scanSnapshot) !== stableSkillPackageValue(target.scanSnapshot)) {
    out.push({
      legacyConvexId: source.legacyConvexId,
      fieldName: 'scan',
      differenceKind: 'value_mismatch',
      classification: 'unclassified',
      summary: 'scan snapshot differs',
    });
  }
  if (stableSkillPackageValue(source.fileMetadata) !== stableSkillPackageValue(target.fileMetadata)) {
    out.push({
      legacyConvexId: source.legacyConvexId,
      fieldName: 'version',
      differenceKind: 'value_mismatch',
      classification: 'unclassified',
      summary: 'version file metadata differs',
    });
  }

  const targetArtifacts = new Map(target.artifacts.map((artifact) => [artifactKey(artifact), artifact]));
  for (const artifact of source.artifacts) {
    const candidate = targetArtifacts.get(artifactKey(artifact));
    if (
      !candidate ||
      candidate.sizeBytes !== artifact.sizeBytes ||
      candidate.mimeType !== artifact.mimeType ||
      candidate.legacyStorageId !== artifact.legacyStorageId
    ) {
      out.push({
        legacyConvexId: source.legacyConvexId,
        fieldName: 'artifact',
        differenceKind: candidate ? 'value_mismatch' : 'missing',
        classification: 'unclassified',
        summary: `artifact ${artifact.path} differs or is absent`,
      });
    }
  }
  for (const artifact of target.artifacts) {
    if (!source.artifacts.some((sourceArtifact) => artifactKey(sourceArtifact) === artifactKey(artifact))) {
      out.push({
        legacyConvexId: target.legacyConvexId,
        fieldName: 'artifact',
        differenceKind: 'orphan',
        classification: 'unclassified',
        summary: `target-only artifact ${artifact.path}`,
      });
    }
  }
  return out;
};

export const reconcileSkillPackageAggregates = (input: Readonly<{
  source: readonly SkillPackageAggregateSnapshot[];
  target: readonly SkillPackageAggregateSnapshot[];
}>): readonly SkillPackageReconciliationDifference[] => {
  const source = new Map(
    input.source.map((snapshot) => [
      `${snapshot.domain}:${snapshot.legacyConvexId}`,
      normalizeSkillPackageAggregate(snapshot),
    ]),
  );
  const target = new Map(
    input.target.map((snapshot) => [
      `${snapshot.domain}:${snapshot.legacyConvexId}`,
      normalizeSkillPackageAggregate(snapshot),
    ]),
  );

  return [...new Set([...source.keys(), ...target.keys()])]
    .sort()
    .flatMap((key) => {
      const sourceSnapshot = source.get(key);
      const targetSnapshot = target.get(key);
      if (!sourceSnapshot || !targetSnapshot) {
        return [
          {
            legacyConvexId: (sourceSnapshot ?? targetSnapshot)!.legacyConvexId,
            fieldName: 'aggregate' as const,
            differenceKind: sourceSnapshot ? ('missing' as const) : ('orphan' as const),
            classification: 'unclassified' as const,
            summary: sourceSnapshot ? 'target aggregate is absent' : 'target-only aggregate is orphaned',
          },
        ];
      }

      const differences: SkillPackageReconciliationDifference[] = [];
      const sourceFacts = { ...sourceSnapshot, ownerPublisherLegacyConvexId: null, versions: [] };
      const targetFacts = { ...targetSnapshot, ownerPublisherLegacyConvexId: null, versions: [] };
      if (stableSkillPackageAggregate(sourceFacts) !== stableSkillPackageAggregate(targetFacts)) {
        differences.push({
          legacyConvexId: sourceSnapshot.legacyConvexId,
          fieldName: 'aggregate',
          differenceKind: 'value_mismatch',
          classification: 'unclassified',
          summary: 'normalized aggregate differs',
        });
      }
      if (sourceSnapshot.ownerPublisherLegacyConvexId !== targetSnapshot.ownerPublisherLegacyConvexId) {
        differences.push({
          legacyConvexId: sourceSnapshot.legacyConvexId,
          fieldName: 'owner',
          differenceKind: 'value_mismatch',
          classification: 'unclassified',
          summary: 'owner publisher differs',
        });
      }

      const targetVersions = new Map(targetSnapshot.versions.map((version) => [version.legacyConvexId, version]));
      for (const version of sourceSnapshot.versions) {
        differences.push(...compareVersion(sourceSnapshot.legacyConvexId, version, targetVersions.get(version.legacyConvexId)));
      }
      for (const version of targetSnapshot.versions) {
        if (!sourceSnapshot.versions.some((sourceVersion) => sourceVersion.legacyConvexId === version.legacyConvexId)) {
          differences.push({
            legacyConvexId: version.legacyConvexId,
            fieldName: 'version',
            differenceKind: 'orphan',
            classification: 'unclassified',
            summary: 'target-only version is orphaned',
          });
        }
      }
      return differences;
    });
};

export type SkillPackageFactDifference = Readonly<{
  field: string;
  kind: 'missing' | 'source_only' | 'target_only' | 'mismatch';
}>;

const stableFactList = (value: readonly unknown[]) =>
  value.map(stableSkillPackageValue).sort().join('|');

export const reconcileSkillPackageFacts = (
  source: SkillPackageFacts,
  target: SkillPackageFacts,
): readonly SkillPackageFactDifference[] => {
  const differences: SkillPackageFactDifference[] = [];
  const compare = (field: string, sourceValue: unknown, targetValue: unknown) => {
    if (sourceValue === undefined && targetValue !== undefined) {
      differences.push({ field, kind: 'source_only' });
    } else if (sourceValue !== undefined && targetValue === undefined) {
      differences.push({ field, kind: 'target_only' });
    } else if (stableSkillPackageValue(sourceValue) !== stableSkillPackageValue(targetValue)) {
      differences.push({ field, kind: 'mismatch' });
    }
  };
  const compareList = (field: string, sourceValue: readonly unknown[], targetValue: readonly unknown[]) => {
    if (stableFactList(sourceValue) !== stableFactList(targetValue)) {
      compare(field, sourceValue, targetValue);
    }
  };

  compareList('aliases', source.aliases, target.aliases);
  compare('github', source.github, target.github);
  compare('fingerprint', source.fingerprint, target.fingerprint);
  compareList('ownership', source.ownership, target.ownership);
  compareList('publishTokens', source.publishTokens, target.publishTokens);
  compareList('uploadTickets', source.uploadTickets, target.uploadTickets);
  compareList('trustedPublishers', source.trustedPublishers, target.trustedPublishers);
  compareList('inspector', source.inspector, target.inspector);
  compare('versionFiles', source.versionFiles, target.versionFiles);
  compare('installEligibility', source.installEligibility, target.installEligibility);
  return differences;
};