export type ProfileProjectionItemKind = 'skill' | 'plugin';
export type ProfileProjectionSort = 'downloads' | 'recent';
export type ProfileProjectionManifestStatus = 'ok' | 'missing' | 'invalid' | 'failed';

export type ProfileProjectionSourcePage<T> = Readonly<{
  items: readonly T[];
  cursor: string | null;
  done: boolean;
}>;

export type ProfileProjectionCatalogItem = Readonly<{
  _id: string;
  kind: ProfileProjectionItemKind;
  displayName: string;
  summary: string | null;
  icon: string | null;
  href: string;
  downloads: number;
  stars: number;
  isOfficial: boolean;
  updatedAt: number;
  sourceBacked?: boolean;
  sourceRepo?: string | null;
  sourcePath?: string | null;
  sourceVerifiedCommit?: string | null;
}>;

export type ProfileProjectionPage = Readonly<{
  page: readonly ProfileProjectionCatalogItem[];
  continueCursor: string;
  isDone: boolean;
}>;

export type ProfileProjectionStarredItem = ProfileProjectionCatalogItem &
  Readonly<{
    starredAt: number;
  }>;

export type ProfileProjectionStarredPage = Readonly<{
  page: readonly ProfileProjectionStarredItem[];
  continueCursor: string;
  isDone: boolean;
}>;

export type ProfileProjectionManifestEntrySource = Readonly<{
  position: number;
  skillKey: string;
}>;

export type ProfileProjectionManifestSectionSource = Readonly<{
  position: number;
  title: string;
  description: string | null;
  entries: readonly ProfileProjectionManifestEntrySource[];
}>;

export type ProfileProjectionManifestSource = Readonly<{
  sourceGitHubLegacyConvexId: string;
  publisherLegacyConvexId: string;
  repo: string;
  status: ProfileProjectionManifestStatus;
  verifiedCommit: string | null;
  notGrouped: 'top' | 'bottom' | null;
  updatedAt: number;
  sections: readonly ProfileProjectionManifestSectionSource[];
}>;

export type ProfileProjectionManifestSection = Readonly<{
  key: string;
  title: string;
  description: string | null;
  sourceRepo: string | null;
  items: readonly ProfileProjectionCatalogItem[];
}>;

export type ProfileProjectionCatalogDisplay = Readonly<{
  mode: 'grouped';
  sourceRepos: readonly string[];
  sections: readonly ProfileProjectionManifestSection[];
}>;

export type ProfileProjectionQuery = Readonly<{
  handle: string;
  kind?: ProfileProjectionItemKind;
  sort?: ProfileProjectionSort;
  paginationOpts: Readonly<{ cursor: string | null; numItems: number }>;
}>;

export type ProfileProjectionReadPort = Readonly<{
  listCatalog: (query: ProfileProjectionQuery) => Promise<ProfileProjectionPage>;
  listStarred: (query: Omit<ProfileProjectionQuery, 'kind'>) => Promise<ProfileProjectionStarredPage>;
  getCatalogDisplay: (
    query: Omit<ProfileProjectionQuery, 'paginationOpts'>,
  ) => Promise<ProfileProjectionCatalogDisplay | null>;
}>;