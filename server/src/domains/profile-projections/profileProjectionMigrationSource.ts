import type {
  ProfileProjectionManifestSource,
  ProfileProjectionSourcePage,
} from './profileProjectionPort.js';
import type { ProfileProjectionSourceCatalogItem } from './profileProjectionDecoder.js';

export type ProfileProjectionCatalogSourceSnapshot = Readonly<{
  publisherLegacyConvexId: string;
  publisherHandle: string;
  item: ProfileProjectionSourceCatalogItem;
}>;

export type ProfileProjectionStarredSourceSnapshot = Readonly<{
  viewerUserLegacyConvexId: string;
  item: ProfileProjectionSourceCatalogItem;
  starredAt: number;
}>;

export type ProfileProjectionMigrationSource = Readonly<{
  listCatalogItems: (input: Readonly<{ cursor: string | null; limit: number }>) => Promise<
    ProfileProjectionSourcePage<ProfileProjectionCatalogSourceSnapshot>
  >;
  listPackageItems: (input: Readonly<{ cursor: string | null; limit: number }>) => Promise<
    ProfileProjectionSourcePage<ProfileProjectionCatalogSourceSnapshot>
  >;
  listStarredItems: (input: Readonly<{ cursor: string | null; limit: number }>) => Promise<
    ProfileProjectionSourcePage<ProfileProjectionStarredSourceSnapshot>
  >;
  listManifests: (input: Readonly<{ cursor: string | null; limit: number }>) => Promise<
    ProfileProjectionSourcePage<ProfileProjectionManifestSource>
  >;
}>;