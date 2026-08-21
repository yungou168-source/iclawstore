import type { SoulFileSnapshot, SoulSnapshot, SoulVersionSnapshot } from './soulMigrationDto.js';
import { normalizeSoulSnapshot, stableSoulSnapshot, stableSoulValue } from './soulNormalizer.js';

export type SoulReconciliationDifference = Readonly<{
  legacyConvexId: string;
  fieldName: 'snapshot' | 'owner' | 'version' | 'file';
  differenceKind: 'missing' | 'value_mismatch' | 'orphan';
  summary: string;
}>;

const fileKey = (file: SoulFileSnapshot) => `${file.path}:${file.sha256}`;

const reconcileVersion = (
  source: SoulVersionSnapshot,
  target: SoulVersionSnapshot | undefined,
): SoulReconciliationDifference[] => {
  if (!target) {
    return [{
      legacyConvexId: source.legacyConvexId,
      fieldName: 'version',
      differenceKind: 'missing',
      summary: 'target version is absent',
    }];
  }

  const differences: SoulReconciliationDifference[] = [];
  const sourceVersion = { ...source, files: [] };
  const targetVersion = { ...target, files: [] };
  if (stableSoulValue(sourceVersion) !== stableSoulValue(targetVersion)) {
    differences.push({
      legacyConvexId: source.legacyConvexId,
      fieldName: 'version',
      differenceKind: 'value_mismatch',
      summary: 'normalized version metadata differs',
    });
  }

  const targetFiles = new Map(target.files.map((file) => [fileKey(file), file]));
  for (const file of source.files) {
    const candidate = targetFiles.get(fileKey(file));
    if (!candidate || stableSoulValue(file) !== stableSoulValue(candidate)) {
      differences.push({
        legacyConvexId: source.legacyConvexId,
        fieldName: 'file',
        differenceKind: candidate ? 'value_mismatch' : 'missing',
        summary: `file ${file.path} differs or is absent`,
      });
    }
  }
  for (const file of target.files) {
    if (!source.files.some((candidate) => fileKey(candidate) === fileKey(file))) {
      differences.push({
        legacyConvexId: target.legacyConvexId,
        fieldName: 'file',
        differenceKind: 'orphan',
        summary: `target-only file ${file.path}`,
      });
    }
  }
  return differences;
};

export const reconcileSoulSnapshots = (input: Readonly<{
  source: readonly SoulSnapshot[];
  target: readonly SoulSnapshot[];
}>): readonly SoulReconciliationDifference[] => {
  const source = new Map(input.source.map((snapshot) => [snapshot.legacyConvexId, normalizeSoulSnapshot(snapshot)]));
  const target = new Map(input.target.map((snapshot) => [snapshot.legacyConvexId, normalizeSoulSnapshot(snapshot)]));

  return [...new Set([...source.keys(), ...target.keys()])].sort().flatMap((legacyConvexId) => {
    const sourceSnapshot = source.get(legacyConvexId);
    const targetSnapshot = target.get(legacyConvexId);
    if (!sourceSnapshot || !targetSnapshot) {
      return [{
        legacyConvexId,
        fieldName: 'snapshot' as const,
        differenceKind: sourceSnapshot ? 'missing' as const : 'orphan' as const,
        summary: sourceSnapshot ? 'target snapshot is absent' : 'target-only snapshot is orphaned',
      }];
    }

    const differences: SoulReconciliationDifference[] = [];
    const sourceFacts = { ...sourceSnapshot, ownerUserLegacyConvexId: '', ownerPublisherLegacyConvexId: null, versions: [] };
    const targetFacts = { ...targetSnapshot, ownerUserLegacyConvexId: '', ownerPublisherLegacyConvexId: null, versions: [] };
    if (stableSoulSnapshot(sourceFacts) !== stableSoulSnapshot(targetFacts)) {
      differences.push({ legacyConvexId, fieldName: 'snapshot', differenceKind: 'value_mismatch', summary: 'normalized snapshot differs' });
    }
    if (
      sourceSnapshot.ownerUserLegacyConvexId !== targetSnapshot.ownerUserLegacyConvexId ||
      sourceSnapshot.ownerPublisherLegacyConvexId !== targetSnapshot.ownerPublisherLegacyConvexId
    ) {
      differences.push({ legacyConvexId, fieldName: 'owner', differenceKind: 'value_mismatch', summary: 'owner or publisher differs' });
    }

    const targetVersions = new Map(targetSnapshot.versions.map((version) => [version.legacyConvexId, version]));
    for (const version of sourceSnapshot.versions) {
      differences.push(...reconcileVersion(version, targetVersions.get(version.legacyConvexId)));
    }
    for (const version of targetSnapshot.versions) {
      if (!sourceSnapshot.versions.some((candidate) => candidate.legacyConvexId === version.legacyConvexId)) {
        differences.push({ legacyConvexId: version.legacyConvexId, fieldName: 'version', differenceKind: 'orphan', summary: 'target-only version is orphaned' });
      }
    }
    return differences;
  });
};