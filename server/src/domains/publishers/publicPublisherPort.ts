export type PublisherKind = "user" | "org";
export type PublisherRole = "owner" | "admin" | "publisher";
export type PublisherCatalogKind = "skill" | "plugin";
export type PublisherCatalogSort = "downloads" | "recent";

export type PublicPublisherStats = Readonly<{
  skills: number;
  packages: number;
  installs: number;
  downloads: number;
  stars: number;
}>;

export type PublicPublisherPublishedItem = Readonly<{
  kind: PublisherCatalogKind;
  displayName: string;
  downloads: number;
}>;

export type PublicPublisher = Readonly<{
  _id: string;
  _creationTime: number;
  kind: PublisherKind;
  handle: string;
  displayName: string;
  image?: string | null;
  bio?: string | null;
  linkedUserId?: string | null;
  official?: boolean;
}>;

export type PublicPublisherListItem = PublicPublisher &
  Readonly<{
    stats: PublicPublisherStats;
    publishedItems: readonly PublicPublisherPublishedItem[];
    starredCount?: number;
    affiliations?: readonly Readonly<{
      publisher: PublicPublisher;
      role: PublisherRole;
    }>[];
  }>;

export type PublicPublisherPage = Readonly<{
  page: readonly PublicPublisherListItem[];
  counts: Readonly<{
    all: number;
    organizations: number;
    individuals: number;
  }>;
  globalCounts?: Readonly<{
    all: number;
    organizations: number;
    individuals: number;
  }>;
  continueCursor: string;
  isDone: boolean;
}>;

export type PublisherDirectoryQuery = Readonly<{
  kind?: PublisherKind;
  query?: string;
  paginationOpts: Readonly<{ cursor: string | null; numItems: number }>;
}>;

export type PublicPublisherMember = Readonly<{
  role: PublisherRole;
  user: Readonly<{
    _id: string;
    handle: string | null;
    displayName: string | null;
    image: string | null;
    official: boolean;
  }>;
}>;

export type PublicPublisherMembers = Readonly<{
  publisher: PublicPublisher | null;
  members: readonly PublicPublisherMember[];
}>;

export type PublicPublisherPort = Readonly<{
  getProfileByHandle: (handle: string) => Promise<PublicPublisherListItem | null>;
  listPublicPage: (query: PublisherDirectoryQuery) => Promise<PublicPublisherPage>;
  listMembers: (publisherHandle: string) => Promise<PublicPublisherMembers | null>;
}>;
