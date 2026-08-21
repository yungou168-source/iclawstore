import { Readable } from "node:stream";
import { makeFunctionReference } from "convex/server";
import type { PublisherAvatarSource } from "./publisherAvatarAssetImport.js";

export type PublisherAvatarSourceMetadata = Readonly<{
  storageId: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  accessScope: "public";
}>;

export type PublisherAvatarSourceReader = Readonly<{
  read: (storageId: string) => Promise<PublisherAvatarSource | null>;
}>;

const avatarSourceReference = makeFunctionReference<
  "query",
  { storageId: string },
  PublisherAvatarSourceMetadata | null
>("publisherMigration:getPublisherAvatarSourceInternal");

const fileNameForContentType = (contentType: string): string => {
  const extension =
    contentType === "image/png"
      ? "png"
      : contentType === "image/jpeg"
        ? "jpg"
        : contentType === "image/webp"
          ? "webp"
          : contentType === "image/gif"
            ? "gif"
            : "bin";
  return `publisher-avatar.${extension}`;
};

export type PublisherAvatarSourceQueryPort = Readonly<{
  query: (
    reference: typeof avatarSourceReference,
    args: { storageId: string },
  ) => Promise<PublisherAvatarSourceMetadata | null>;
}>;

export const createConvexPublisherAvatarSourceReader = (
  convex: PublisherAvatarSourceQueryPort,
  fetchImplementation: typeof fetch = fetch,
): PublisherAvatarSourceReader =>
  Object.freeze({
    read: async (storageId) => {
      const metadata = await convex.query(avatarSourceReference, { storageId });
      if (!metadata) return null;
      const response = await fetchImplementation(metadata.url, { redirect: "error" });
      if (!response.ok || !response.body) {
        throw new Error(`Publisher avatar source request failed with HTTP ${response.status}`);
      }
      const contentType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (contentType !== metadata.contentType) {
        throw new Error("Publisher avatar source content type did not match its metadata");
      }
      const contentLength = response.headers.get("content-length");
      if (contentLength && Number(contentLength) !== metadata.sizeBytes) {
        throw new Error("Publisher avatar source size did not match its metadata");
      }
      return {
        legacyStorageId: metadata.storageId,
        originalFileName: fileNameForContentType(metadata.contentType),
        declaredMimeType: metadata.contentType,
        stream: Readable.fromWeb(response.body as never),
      };
    },
  });
