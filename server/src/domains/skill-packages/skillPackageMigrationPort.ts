export type SkillPackageDomain = 'skill' | 'package';
export type SkillPackageVisibility = 'public' | 'private' | 'hidden' | 'deleted';
export type SkillPackageCopyStatus = 'pending' | 'copying' | 'copied' | 'failed';

export type SkillPackageAliasFact = Readonly<{
  aliasKind: string;
  aliasValue: string;
  isCanonical: boolean;
  retiredAt: number | null;
}>;

export type SkillPackageGithubFact = Readonly<{
  sourceLegacyConvexId: string | null;
  repository: string | null;
  path: string | null;
  commit: string | null;
  contentHash: string | null;
  status: string | null;
}>;

export type SkillPackageOwnershipFact = Readonly<{
  ownerUserLegacyConvexId: string | null;
  ownerPublisherLegacyConvexId: string | null;
  eventKind: string;
  effectiveAt: number;
  actorUserLegacyConvexId: string | null;
}>;

export type SkillPackageVersionFileFact = Readonly<{
  path: string;
  sizeBytes: number;
  mimeType: string;
  sha256: string;
  storageLegacyConvexId: string | null;
}>;

export type SkillPackagePublishTokenFact = Readonly<{
  legacyConvexId: string;
  tokenHash: string;
  provider: string;
  repository: string;
  workflowFilename: string;
  expiresAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}>;

export type SkillPackageUploadTicketFact = Readonly<{
  legacyConvexId: string;
  kind: string;
  publishTokenLegacyConvexId: string | null;
  userLegacyConvexId: string | null;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  storageLegacyConvexId: string | null;
}>;

export type SkillPackageTrustedPublisherFact = Readonly<{
  legacyConvexId: string;
  provider: string;
  repository: string;
  repositoryId: string;
  workflowFilename: string;
  environment: string | null;
}>;

export type SkillPackageInspectorFact = Readonly<{
  legacyConvexId: string;
  releaseLegacyConvexId: string;
  status: string;
  inspectorVersion: string | null;
  targetRuntimeVersion: string | null;
  findingCount: number;
  findingsHash: string | null;
  createdAt: number;
}>;

export type SkillPackageFacts = Readonly<{
  aliases: readonly SkillPackageAliasFact[];
  github: SkillPackageGithubFact | null;
  fingerprint: string | null;
  ownership: readonly SkillPackageOwnershipFact[];
  publishTokens: readonly SkillPackagePublishTokenFact[];
  uploadTickets: readonly SkillPackageUploadTicketFact[];
  trustedPublishers: readonly SkillPackageTrustedPublisherFact[];
  inspector: readonly SkillPackageInspectorFact[];
  versionFiles: Readonly<Record<string, readonly SkillPackageVersionFileFact[]>>;
  installEligibility: Readonly<Record<string, unknown>> | null;
}>;

export type SkillPackageArtifactSnapshot = Readonly<{
  legacyStorageId: string | null;
  path: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}>;

export type SkillPackageVersionSnapshot = Readonly<{
  legacyConvexId: string;
  semanticVersion: string;
  sourceHash: string;
  sourceMetadata: Readonly<Record<string, unknown>>;
  scanSnapshot: Readonly<Record<string, unknown>> | null;
  fileMetadata?: readonly SkillPackageVersionFileFact[];
  legacyCreatedAt: number;
  legacyUpdatedAt: number;
  artifacts: readonly SkillPackageArtifactSnapshot[];
}>;

export type SkillPackageAggregateSnapshot = Readonly<{
  domain: SkillPackageDomain;
  legacyConvexId: string;
  ownerPublisherLegacyConvexId: string | null;
  canonicalName: string;
  displayName: string;
  summary: string | null;
  visibility: SkillPackageVisibility;
  metadata: Readonly<Record<string, unknown>>;
  facts?: SkillPackageFacts;
  legacyUpdatedAt: number;
  sourceHash: string;
  versions: readonly SkillPackageVersionSnapshot[];
}>;

export type SkillPackageSourcePage<T> = Readonly<{
  items: readonly T[];
  cursor: string | null;
  done: boolean;
}>;

export type SkillMigrationSource = Readonly<{
  listSkillAggregates: (input: Readonly<{
    cursor: string | null;
    limit: number;
  }>) => Promise<SkillPackageSourcePage<SkillPackageAggregateSnapshot>>;
}>;

export type PackageMigrationSource = Readonly<{
  listPackageAggregates: (input: Readonly<{
    cursor: string | null;
    limit: number;
  }>) => Promise<SkillPackageSourcePage<SkillPackageAggregateSnapshot>>;
}>;

export type SkillPackageMigrationSource = Readonly<{
  listAggregates: (input: Readonly<{
    domain: SkillPackageDomain;
    cursor: string | null;
    limit: number;
  }>) => Promise<SkillPackageSourcePage<SkillPackageAggregateSnapshot>>;
}>;

export type SkillPackageImportPage = Readonly<{
  batchId: string;
  domain: SkillPackageDomain;
  items: readonly SkillPackageAggregateSnapshot[];
  nextCursor: string | null;
  done: boolean;
}>;

export type SkillPackageImportResult = Readonly<{
  upsertedCount: number;
  unchangedCount: number;
}>;

export type SkillPackageTargetRepository = Readonly<{
  importPage: (page: SkillPackageImportPage) => Promise<SkillPackageImportResult>;
  listAggregates: (input: Readonly<{
    domain: SkillPackageDomain;
    cursor: string | null;
    limit: number;
  }>) => Promise<SkillPackageSourcePage<SkillPackageAggregateSnapshot>>;
}>;

export type ArtifactCopyRequest = Readonly<{
  domain: SkillPackageDomain;
  versionLegacyConvexId: string;
  artifact: SkillPackageArtifactSnapshot;
}>;

export type ArtifactCopyPort = Readonly<{
  copy: (request: ArtifactCopyRequest) => Promise<Readonly<{
    status: Extract<SkillPackageCopyStatus, 'copied' | 'failed'>;
    targetAssetId: string | null;
    failureCode: string | null;
  }>>;
}>;