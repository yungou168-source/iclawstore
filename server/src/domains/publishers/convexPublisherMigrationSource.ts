import { makeFunctionReference, type FunctionReference } from "convex/server";
import type {
  OfficialPublisherSourceSnapshot,
  PublisherMemberSourceSnapshot,
  PublisherMigrationSource,
  PublisherSourcePage,
  PublisherSourceSnapshot,
} from "./publisherMigrationSource.js";

type QueryCapability = Readonly<{
  query: (reference: FunctionReference<"query">, args: Record<string, unknown>) => Promise<unknown>;
}>;

const publisherPageReference = makeFunctionReference<
  "query",
  { cursor?: string; limit?: number },
  PublisherSourcePage<PublisherSourceSnapshot>
>("publisherMigration:listPublisherSnapshotPageInternal");

const memberPageReference = makeFunctionReference<
  "query",
  { cursor?: string; limit?: number },
  PublisherSourcePage<PublisherMemberSourceSnapshot>
>("publisherMigration:listPublisherMemberSnapshotPageInternal");

const officialPageReference = makeFunctionReference<
  "query",
  { cursor?: string; limit?: number },
  PublisherSourcePage<OfficialPublisherSourceSnapshot>
>("publisherMigration:listOfficialPublisherSnapshotPageInternal");

const pageArgs = (input: Readonly<{ cursor: string | null; limit: number }>) => ({
  cursor: input.cursor ?? undefined,
  limit: input.limit,
});

export const createConvexPublisherMigrationSource = (
  capability: QueryCapability,
): PublisherMigrationSource =>
  Object.freeze({
    listPublishers: (input) =>
      capability.query(publisherPageReference, pageArgs(input)) as Promise<
        PublisherSourcePage<PublisherSourceSnapshot>
      >,
    listMembers: (input) =>
      capability.query(memberPageReference, pageArgs(input)) as Promise<
        PublisherSourcePage<PublisherMemberSourceSnapshot>
      >,
    listOfficialPublishers: (input) =>
      capability.query(officialPageReference, pageArgs(input)) as Promise<
        PublisherSourcePage<OfficialPublisherSourceSnapshot>
      >,
  });
