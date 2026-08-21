import { makeFunctionReference } from "convex/server";
import type {
  PublicPublisherListItem,
  PublicPublisherMembers,
  PublicPublisherPage,
  PublicPublisherPort,
  PublisherDirectoryQuery,
} from "./publicPublisherPort.js";

export type PublisherQueryClient = Readonly<{
  query: <Result>(reference: unknown, args: unknown) => Promise<Result>;
}>;

const getProfileByHandle = makeFunctionReference<
  "query",
  { handle: string },
  PublicPublisherListItem | null
>("publishers:getProfileByHandle");

const listPublicPage = makeFunctionReference<"query", PublisherDirectoryQuery, PublicPublisherPage>(
  "publishers:listPublicPage",
);

const listMembers = makeFunctionReference<
  "query",
  { publisherHandle: string },
  PublicPublisherMembers | null
>("publishers:listMembers");

export const createConvexPublicPublisherAdapter = (
  client: PublisherQueryClient,
): PublicPublisherPort =>
  Object.freeze({
    getProfileByHandle: async (handle) => client.query(getProfileByHandle, { handle }),
    listPublicPage: async (query) => client.query(listPublicPage, query),
    listMembers: async (publisherHandle) => client.query(listMembers, { publisherHandle }),
  });
