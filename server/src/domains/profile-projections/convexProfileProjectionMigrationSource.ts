import { makeFunctionReference, type FunctionReference } from 'convex/server';
import type { ProfileProjectionSourcePage, ProfileProjectionManifestSource } from './profileProjectionPort.js';
import type {
  ProfileProjectionCatalogSourceSnapshot,
  ProfileProjectionMigrationSource,
  ProfileProjectionStarredSourceSnapshot,
} from './profileProjectionMigrationSource.js';

type QueryCapability = Readonly<{
  query: (reference: FunctionReference<'query'>, args: Record<string, unknown>) => Promise<unknown>;
}>;

const catalogPageReference = makeFunctionReference<
  'query',
  { cursor?: string; limit?: number },
  ProfileProjectionSourcePage<ProfileProjectionCatalogSourceSnapshot>
>('profileProjectionMigration:listCatalogSnapshotPageInternal');

const packagePageReference = makeFunctionReference<
  'query',
  { cursor?: string; limit?: number },
  ProfileProjectionSourcePage<ProfileProjectionCatalogSourceSnapshot>
>('profileProjectionMigration:listPackageSnapshotPageInternal');

const starredPageReference = makeFunctionReference<
  'query',
  { cursor?: string; limit?: number },
  ProfileProjectionSourcePage<ProfileProjectionStarredSourceSnapshot>
>('profileProjectionMigration:listStarredSnapshotPageInternal');

const manifestPageReference = makeFunctionReference<
  'query',
  { cursor?: string; limit?: number },
  ProfileProjectionSourcePage<ProfileProjectionManifestSource>
>('profileProjectionMigration:listManifestSnapshotPageInternal');

const pageArgs = (input: Readonly<{ cursor: string | null; limit: number }>) => ({
  cursor: input.cursor ?? undefined,
  limit: input.limit,
});

export type PublishedCatalogProjectionSource = Pick<
  ProfileProjectionMigrationSource,
  'listCatalogItems' | 'listPackageItems'
>;

export type ProfileProjectionConvexSource = Pick<
  ProfileProjectionMigrationSource,
  'listCatalogItems' | 'listPackageItems' | 'listStarredItems' | 'listManifests'
>;

export const createConvexProfileProjectionSource = (
  capability: QueryCapability,
): ProfileProjectionConvexSource =>
  Object.freeze({
    listCatalogItems: (input) =>
      capability.query(catalogPageReference, pageArgs(input)) as Promise<
        ProfileProjectionSourcePage<ProfileProjectionCatalogSourceSnapshot>
      >,
    listPackageItems: (input) =>
      capability.query(packagePageReference, pageArgs(input)) as Promise<
        ProfileProjectionSourcePage<ProfileProjectionCatalogSourceSnapshot>
      >,
    listStarredItems: (input) =>
      capability.query(starredPageReference, pageArgs(input)) as Promise<
        ProfileProjectionSourcePage<ProfileProjectionStarredSourceSnapshot>
      >,
    listManifests: (input) =>
      capability.query(manifestPageReference, pageArgs(input)) as Promise<
        ProfileProjectionSourcePage<ProfileProjectionManifestSource>
      >,
  });

export const createConvexPublishedCatalogProjectionSource = (
  capability: QueryCapability,
): PublishedCatalogProjectionSource => {
  const source = createConvexProfileProjectionSource(capability);
  return Object.freeze({
    listCatalogItems: source.listCatalogItems,
    listPackageItems: source.listPackageItems,
  });
};