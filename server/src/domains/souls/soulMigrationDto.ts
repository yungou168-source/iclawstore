export type SoulAssetReferenceState = 'pending' | 'copied' | 'missing' | 'failed';

export type SoulFileSnapshot = Readonly<{
  path: string;
  sizeBytes: number;
  mimeType: string | null;
  sha256: string;
  legacyStorageId: string | null;
  targetAssetId: string | null;
  assetReferenceState: SoulAssetReferenceState;
}>;

export type SoulVersionSnapshot = Readonly<{
  legacyConvexId: string;
  semanticVersion: string;
  fingerprint: string | null;
  changelog: string;
  changelogSource: string | null;
  parsedMetadata: Readonly<Record<string, unknown>>;
  createdByUserLegacyConvexId: string;
  legacyCreatedAt: number;
  softDeletedAt: number | null;
  sourceHash: string;
  files: readonly SoulFileSnapshot[];
}>;

export type SoulSnapshot = Readonly<{
  legacyConvexId: string;
  slug: string;
  displayName: string;
  summary: string | null;
  ownerUserLegacyConvexId: string;
  ownerPublisherLegacyConvexId: string | null;
  latestVersionLegacyConvexId: string | null;
  tags: Readonly<Record<string, string>>;
  stats: Readonly<Record<string, number>>;
  legacyCreatedAt: number;
  legacyUpdatedAt: number;
  softDeletedAt: number | null;
  sourceHash: string;
  versions: readonly SoulVersionSnapshot[];
}>;