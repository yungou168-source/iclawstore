export type PublisherKind = "user" | "org";
export type PublisherRole = "owner" | "admin" | "publisher";

export type PublisherSourceSnapshot = Readonly<{
  legacyConvexId: string;
  legacyCreationTime: number;
  kind: PublisherKind;
  handle: string;
  displayName: string;
  bio: string | null;
  image: string | null;
  imageStorageId: string | null;
  linkedUserLegacyConvexId: string | null;
  trustedPublisher: boolean;
  publishedSkills: number;
  publishedPackages: number;
  totalInstalls: number;
  totalDownloads: number;
  totalStars: number;
  skillTotalInstalls: number;
  skillTotalDownloads: number;
  skillTotalStars: number;
  deletedAt: number | null;
  deactivatedAt: number | null;
  legacyCreatedAt: number;
  legacyUpdatedAt: number;
}>;

export type PublisherMemberSourceSnapshot = Readonly<{
  legacyConvexId: string;
  legacyCreationTime: number;
  publisherLegacyConvexId: string;
  memberUserLegacyConvexId: string;
  role: PublisherRole;
  legacyCreatedAt: number;
  legacyUpdatedAt: number;
}>;

export type OfficialPublisherSourceSnapshot = Readonly<{
  legacyConvexId: string;
  legacyCreationTime: number;
  publisherLegacyConvexId: string;
  reason: string | null;
  createdByUserLegacyConvexId: string | null;
  legacyCreatedAt: number;
  legacyUpdatedAt: number;
}>;

export type PublisherSourcePage<T> = Readonly<{
  items: readonly T[];
  cursor: string | null;
  done: boolean;
}>;

export type PublisherMigrationSource = Readonly<{
  listPublishers: (
    input: Readonly<{ cursor: string | null; limit: number }>,
  ) => Promise<PublisherSourcePage<PublisherSourceSnapshot>>;
  listMembers: (
    input: Readonly<{ cursor: string | null; limit: number }>,
  ) => Promise<PublisherSourcePage<PublisherMemberSourceSnapshot>>;
  listOfficialPublishers: (
    input: Readonly<{ cursor: string | null; limit: number }>,
  ) => Promise<PublisherSourcePage<OfficialPublisherSourceSnapshot>>;
}>;
