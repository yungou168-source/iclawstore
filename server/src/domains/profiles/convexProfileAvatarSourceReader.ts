import { Readable } from 'node:stream';
import { makeFunctionReference } from 'convex/server';
import type { ProfileAvatarSource } from './profileAvatarAssetImport.js';

export type ProfileAvatarSourceMetadata = Readonly<{
  storageId: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  accessScope: 'public';
}>;

export type ProfileAvatarSourceReader = Readonly<{
  read: (storageId: string) => Promise<ProfileAvatarSource | null>;
}>;

const avatarSourceReference = makeFunctionReference<
  'query',
  { storageId: string },
  ProfileAvatarSourceMetadata | null
>('profileMigration:getProfileAvatarSourceInternal');

const fileNameForContentType = (contentType: string): string => {
  const extension = contentType === 'image/png'
    ? 'png'
    : contentType === 'image/jpeg'
      ? 'jpg'
      : contentType === 'image/webp'
        ? 'webp'
        : contentType === 'image/gif'
          ? 'gif'
          : 'bin';
  return `profile-avatar.${extension}`;
};

export type ProfileAvatarSourceQueryPort = Readonly<{
  query: (
    reference: typeof avatarSourceReference,
    args: { storageId: string },
  ) => Promise<ProfileAvatarSourceMetadata | null>;
}>;

export const createConvexProfileAvatarSourceReader = (
  convex: ProfileAvatarSourceQueryPort,
  fetchImplementation: typeof fetch = fetch,
): ProfileAvatarSourceReader =>
  Object.freeze({
    read: async (storageId) => {
      const metadata = await convex.query(avatarSourceReference, { storageId });
      if (!metadata) return null;
      const response = await fetchImplementation(metadata.url, { redirect: 'error' });
      if (!response.ok || !response.body) {
        throw new Error(`Profile avatar source request failed with HTTP ${response.status}`);
      }
      const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
      if (contentType !== metadata.contentType) {
        throw new Error('Profile avatar source content type did not match its metadata');
      }
      const contentLength = response.headers.get('content-length');
      if (contentLength && Number(contentLength) !== metadata.sizeBytes) {
        throw new Error('Profile avatar source size did not match its metadata');
      }
      return {
        legacyStorageId: metadata.storageId,
        originalFileName: fileNameForContentType(metadata.contentType),
        declaredMimeType: metadata.contentType,
        stream: Readable.fromWeb(response.body as never),
      };
    },
  });