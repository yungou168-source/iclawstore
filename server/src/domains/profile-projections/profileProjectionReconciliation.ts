import type { ProfileProjectionManifestSource } from './profileProjectionPort.js';
import type {
  ProfileProjectionCatalogSourceSnapshot,
  ProfileProjectionStarredSourceSnapshot,
} from './profileProjectionMigrationSource.js';

export type ProfileProjectionReconciliationPhase = 'catalog' | 'packages' | 'starred' | 'manifests';

export type ProfileProjectionReconciliationDifference = Readonly<{
  legacyConvexId: string;
  fieldName: string;
  differenceKind: 'missing' | 'value_mismatch' | 'invariant_violation';
  summary: string;
}>;

type SourceSnapshot =
  | ProfileProjectionCatalogSourceSnapshot
  | ProfileProjectionStarredSourceSnapshot
  | ProfileProjectionManifestSource;

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

const keyFor = (phase: ProfileProjectionReconciliationPhase, snapshot: SourceSnapshot): string => {
  if (phase === 'catalog' || phase === 'packages') {
    return (snapshot as ProfileProjectionCatalogSourceSnapshot).item.legacyConvexId;
  }
  if (phase === 'starred') {
    const starred = snapshot as ProfileProjectionStarredSourceSnapshot;
    return `${starred.viewerUserLegacyConvexId}:${starred.item.legacyConvexId}`;
  }
  return (snapshot as ProfileProjectionManifestSource).sourceGitHubLegacyConvexId;
};

const fieldValues = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const compareSnapshots = (
  legacyConvexId: string,
  source: SourceSnapshot | null,
  target: SourceSnapshot | null,
): ProfileProjectionReconciliationDifference[] => {
  if (!source || !target) {
    return [{
      legacyConvexId,
      fieldName: 'record',
      differenceKind: 'missing',
      summary: source ? 'target projection is absent' : 'source projection is absent',
    }];
  }
  const sourceFields = fieldValues(source);
  const targetFields = fieldValues(target);
  return [...new Set([...Object.keys(sourceFields), ...Object.keys(targetFields)])]
    .sort()
    .flatMap((fieldName) => stableValue(sourceFields[fieldName]) === stableValue(targetFields[fieldName]) ? [] : [{
      legacyConvexId,
      fieldName,
      differenceKind: 'value_mismatch' as const,
      summary: `${fieldName} differs`,
    }]);
};

export const reconcileProfileProjectionPhase = <T extends SourceSnapshot>(input: Readonly<{
  phase: ProfileProjectionReconciliationPhase;
  source: readonly T[];
  target: readonly T[];
}>): readonly ProfileProjectionReconciliationDifference[] => {
  const source = new Map(input.source.map((snapshot) => [keyFor(input.phase, snapshot), snapshot]));
  const target = new Map(input.target.map((snapshot) => [keyFor(input.phase, snapshot), snapshot]));
  return [...new Set([...source.keys(), ...target.keys()])]
    .sort()
    .flatMap((key) => compareSnapshots(key, source.get(key) ?? null, target.get(key) ?? null));
};