import type { ProfileAvatarAsset } from './profileAvatarAssetImport.js';

export type ProfileReconciliationSnapshot = Readonly<{
  legacyConvexId: string;
  handle: string | null;
  profileSlug: string | null;
  personalPublisherLegacyConvexId: string | null;
  deletedAt: number | null;
  deactivatedAt: number | null;
  purgedAt: number | null;
  banReason: string | null;
  imageStorageId: string | null;
  aliases?: readonly ProfileIdentityAlias[];
}>;

export type ProfileReconciliationDifference = Readonly<{
  legacyConvexId: string;
  fieldName: string;
  differenceKind: 'missing' | 'value_mismatch';
  summary: string;
  sourceEvidence?: Readonly<Record<string, unknown>>;
  targetEvidence?: Readonly<Record<string, unknown>>;
}>;

const profileFields = [
  'handle',
  'profileSlug',
  'personalPublisherLegacyConvexId',
  'deletedAt',
  'deactivatedAt',
  'purgedAt',
  'banReason',
  'imageStorageId',
] as const;

export const reconcileProfileSnapshots = (
  source: ProfileReconciliationSnapshot | null,
  target: ProfileReconciliationSnapshot | null,
): ProfileReconciliationDifference[] => {
  const legacyConvexId = source?.legacyConvexId ?? target?.legacyConvexId;
  if (!legacyConvexId || (!source && !target)) return [];
  if (!target) {
    return [{ legacyConvexId, fieldName: 'profile', differenceKind: 'missing', summary: 'target profile is absent' }];
  }
  if (!source) {
    return [{ legacyConvexId, fieldName: 'profile', differenceKind: 'missing', summary: 'source profile is absent' }];
  }
  return profileFields.flatMap((fieldName) =>
    source[fieldName] === target[fieldName]
      ? []
      : [{ legacyConvexId, fieldName, differenceKind: 'value_mismatch' as const, summary: `${fieldName} differs` }],
  );
};

export type ProfileIdentityAlias = Readonly<{
  aliasKind: 'profile_slug' | 'user_handle';
  aliasValue: string;
  isCanonical: boolean;
  retiredAt?: number | null;
}>;

const normalizeAliasValue = (value: string) => value.trim().toLowerCase();

export const reconcileProfileAliases = (
  source: Pick<ProfileReconciliationSnapshot, 'legacyConvexId' | 'profileSlug' | 'handle'> & {
    aliases?: readonly ProfileIdentityAlias[];
  },
  target: readonly ProfileIdentityAlias[],
): ProfileReconciliationDifference[] => {
  const sourceAliases = new Map(
    (source.aliases ?? []).map((alias) => [
      `${alias.aliasKind}:${normalizeAliasValue(alias.aliasValue)}`,
      alias,
    ]),
  );
  for (const alias of [
    source.profileSlug
      ? { aliasKind: 'profile_slug' as const, aliasValue: source.profileSlug }
      : null,
    source.handle ? { aliasKind: 'user_handle' as const, aliasValue: source.handle } : null,
  ]) {
    if (!alias) continue;
    const key = `${alias.aliasKind}:${normalizeAliasValue(alias.aliasValue)}`;
    if (!sourceAliases.has(key)) {
      sourceAliases.set(key, { ...alias, isCanonical: true, retiredAt: null });
    }
  }

  const targetAliases = new Map(
    target.map((alias) => [
      `${alias.aliasKind}:${normalizeAliasValue(alias.aliasValue)}`,
      alias,
    ]),
  );
  const differences: ProfileReconciliationDifference[] = [];
  for (const [key, sourceAlias] of sourceAliases) {
    const targetAlias = targetAliases.get(key);
    if (!targetAlias) {
      differences.push({
        legacyConvexId: source.legacyConvexId,
        fieldName: `aliases.${sourceAlias.aliasKind}.${sourceAlias.aliasValue}`,
        differenceKind: 'missing',
        summary: 'source alias is absent from target',
      });
      continue;
    }
    if (
      targetAlias.isCanonical !== sourceAlias.isCanonical ||
      (targetAlias.retiredAt ?? null) !== (sourceAlias.retiredAt ?? null)
    ) {
      differences.push({
        legacyConvexId: source.legacyConvexId,
        fieldName: `aliases.${sourceAlias.aliasKind}.${sourceAlias.aliasValue}`,
        differenceKind: 'value_mismatch',
        summary: 'alias canonical or retirement state differs',
      });
    }
  }
  for (const [key, targetAlias] of targetAliases) {
    if (sourceAliases.has(key)) continue;
    differences.push({
      legacyConvexId: source.legacyConvexId,
      fieldName: `aliases.${targetAlias.aliasKind}.${targetAlias.aliasValue}`,
      differenceKind: 'missing',
      summary: 'target contains an extra alias',
    });
  }
  return differences;
};

export const reconcileProfileCanonicalAliases = (
  source: Pick<ProfileReconciliationSnapshot, 'legacyConvexId' | 'profileSlug' | 'handle'>,
  target: readonly ProfileIdentityAlias[],
): ProfileReconciliationDifference[] => {
  const expected = [
    source.profileSlug ? { aliasKind: 'profile_slug' as const, aliasValue: source.profileSlug } : null,
    source.handle ? { aliasKind: 'user_handle' as const, aliasValue: source.handle } : null,
  ].filter((alias): alias is { aliasKind: ProfileIdentityAlias['aliasKind']; aliasValue: string } => alias !== null);
  return expected.flatMap((alias) =>
    target.some(
      (candidate) => candidate.isCanonical &&
        candidate.aliasKind === alias.aliasKind &&
        normalizeAliasValue(candidate.aliasValue) === normalizeAliasValue(alias.aliasValue),
    )
      ? []
      : [{
          legacyConvexId: source.legacyConvexId,
          fieldName: `aliases.${alias.aliasKind}`,
          differenceKind: 'missing' as const,
          summary: `canonical ${alias.aliasKind} alias is absent`,
        }],
  );
};

export const reconcileProfileAvatarAsset = (
  legacyConvexId: string,
  sourceStorageId: string | null,
  source: Pick<ProfileAvatarAsset, 'mimeType' | 'sizeBytes' | 'sha256'> | null,
  target: Pick<ProfileAvatarAsset, 'legacyStorageId' | 'mimeType' | 'sizeBytes' | 'sha256' | 'status'> | null,
): ProfileReconciliationDifference[] => {
  if (!sourceStorageId) return target?.status === 'active'
    ? [{ legacyConvexId, fieldName: 'avatar', differenceKind: 'value_mismatch', summary: 'target avatar exists without source storage reference' }]
    : [];
  if (!source || !target || target.status !== 'active') {
    return [{ legacyConvexId, fieldName: 'avatar', differenceKind: 'missing', summary: 'active avatar is absent from one side' }];
  }
  const fields = ['legacyStorageId', 'mimeType', 'sizeBytes', 'sha256'] as const;
  const expected = { legacyStorageId: sourceStorageId, ...source };
  return fields.flatMap((fieldName) =>
    expected[fieldName] === target[fieldName]
      ? []
      : [{ legacyConvexId, fieldName: `avatar.${fieldName}`, differenceKind: 'value_mismatch' as const, summary: `avatar ${fieldName} differs` }],
  );
};