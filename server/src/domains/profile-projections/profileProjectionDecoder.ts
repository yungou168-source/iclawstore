import type {
  ProfileProjectionCatalogItem,
  ProfileProjectionItemKind,
  ProfileProjectionSort,
} from './profileProjectionPort';

export type ProfileProjectionSourceCatalogItem = Readonly<{
  legacyConvexId: string;
  kind: ProfileProjectionItemKind;
  slug?: string | null;
  displayName: string;
  summary?: string | null;
  icon?: string | null;
  href: string;
  canonicalStats: Readonly<{
    downloads: number;
    stars: number;
  }>;
  isOfficial: boolean;
  updatedAt: number;
  sourceGitHubId?: string | null;
  sourceRepo?: string | null;
  sourcePath?: string | null;
  sourceVerifiedCommit?: string | null;
}>;

export type DecodedProfileProjectionCatalogItem = ProfileProjectionCatalogItem &
  Readonly<{
    legacyConvexId: string;
    slug: string | null;
    sourceGitHubId: string | null;
  }>;

const nullable = (value: string | null | undefined) => value ?? null;

export function decodeProfileProjectionCatalogItem(
  item: ProfileProjectionSourceCatalogItem,
): DecodedProfileProjectionCatalogItem {
  const sourceGitHubId = nullable(item.sourceGitHubId);
  const sourceBacked = sourceGitHubId !== null;

  return {
    _id: item.legacyConvexId,
    legacyConvexId: item.legacyConvexId,
    kind: item.kind,
    slug: nullable(item.slug),
    displayName: item.displayName,
    summary: nullable(item.summary),
    icon: nullable(item.icon),
    href: item.href,
    downloads: item.canonicalStats.downloads,
    stars: item.canonicalStats.stars,
    isOfficial: item.isOfficial,
    updatedAt: item.updatedAt,
    sourceBacked,
    sourceGitHubId,
    sourceRepo: sourceBacked ? nullable(item.sourceRepo) : null,
    sourcePath: sourceBacked ? nullable(item.sourcePath) : null,
    sourceVerifiedCommit: sourceBacked ? nullable(item.sourceVerifiedCommit) : null,
  };
}

export function compareProfileProjectionCatalogItems(sort: ProfileProjectionSort) {
  return (a: ProfileProjectionCatalogItem, b: ProfileProjectionCatalogItem) => {
    if (sort === 'recent') {
      return (
        b.updatedAt - a.updatedAt ||
        b.downloads - a.downloads ||
        b.stars - a.stars ||
        a.displayName.localeCompare(b.displayName)
      );
    }

    return (
      b.downloads - a.downloads ||
      b.stars - a.stars ||
      b.updatedAt - a.updatedAt ||
      a.displayName.localeCompare(b.displayName)
    );
  };
}

export function decodeAndSortProfileProjectionCatalogItems(
  items: readonly ProfileProjectionSourceCatalogItem[],
  sort: ProfileProjectionSort = 'downloads',
): DecodedProfileProjectionCatalogItem[] {
  return items.map(decodeProfileProjectionCatalogItem).sort(compareProfileProjectionCatalogItems(sort));
}