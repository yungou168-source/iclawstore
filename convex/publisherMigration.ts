import { v } from "convex/values";
import { internalQuery } from "./functions";

const pageSize = (value: number | undefined) => Math.max(1, Math.min(value ?? 100, 250));

const publisherSnapshot = (publisher: {
  _id: string;
  _creationTime: number;
  kind: "user" | "org";
  handle: string;
  displayName: string;
  bio?: string;
  image?: string;
  imageStorageId?: string;
  linkedUserId?: string;
  trustedPublisher?: boolean;
  publishedSkills?: number;
  publishedPackages?: number;
  totalInstalls?: number;
  totalDownloads?: number;
  totalStars?: number;
  skillTotalInstalls?: number;
  skillTotalDownloads?: number;
  skillTotalStars?: number;
  deactivatedAt?: number;
  deletedAt?: number;
  createdAt: number;
  updatedAt: number;
}) => ({
  legacyConvexId: publisher._id,
  legacyCreationTime: publisher._creationTime,
  kind: publisher.kind,
  handle: publisher.handle,
  displayName: publisher.displayName,
  bio: publisher.bio ?? null,
  image: publisher.image ?? null,
  imageStorageId: publisher.imageStorageId ?? null,
  linkedUserLegacyConvexId: publisher.linkedUserId ?? null,
  trustedPublisher: publisher.trustedPublisher ?? false,
  publishedSkills: publisher.publishedSkills ?? 0,
  publishedPackages: publisher.publishedPackages ?? 0,
  totalInstalls: publisher.totalInstalls ?? 0,
  totalDownloads: publisher.totalDownloads ?? 0,
  totalStars: publisher.totalStars ?? 0,
  skillTotalInstalls: publisher.skillTotalInstalls ?? 0,
  skillTotalDownloads: publisher.skillTotalDownloads ?? 0,
  skillTotalStars: publisher.skillTotalStars ?? 0,
  deletedAt: publisher.deletedAt ?? null,
  deactivatedAt: publisher.deactivatedAt ?? null,
  legacyCreatedAt: publisher.createdAt,
  legacyUpdatedAt: publisher.updatedAt,
});

const memberSnapshot = (member: {
  _id: string;
  _creationTime: number;
  publisherId: string;
  userId: string;
  role: "owner" | "admin" | "publisher";
  createdAt: number;
  updatedAt: number;
}) => ({
  legacyConvexId: member._id,
  legacyCreationTime: member._creationTime,
  publisherLegacyConvexId: member.publisherId,
  memberUserLegacyConvexId: member.userId,
  role: member.role,
  legacyCreatedAt: member.createdAt,
  legacyUpdatedAt: member.updatedAt,
});

const officialSnapshot = (official: {
  _id: string;
  _creationTime: number;
  publisherId: string;
  reason?: string;
  createdByUserId?: string;
  createdAt: number;
  updatedAt: number;
}) => ({
  legacyConvexId: official._id,
  legacyCreationTime: official._creationTime,
  publisherLegacyConvexId: official.publisherId,
  reason: official.reason ?? null,
  createdByUserLegacyConvexId: official.createdByUserId ?? null,
  legacyCreatedAt: official.createdAt,
  legacyUpdatedAt: official.updatedAt,
});

export const listPublisherSnapshotPageInternal = internalQuery({
  args: { cursor: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("publishers")
      .order("asc")
      .paginate({
        cursor: args.cursor ?? null,
        numItems: pageSize(args.limit),
      });
    return {
      items: page.page.map(publisherSnapshot),
      cursor: page.isDone ? null : page.continueCursor,
      done: page.isDone,
    };
  },
});

export const listPublisherMemberSnapshotPageInternal = internalQuery({
  args: { cursor: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("publisherMembers")
      .order("asc")
      .paginate({
        cursor: args.cursor ?? null,
        numItems: pageSize(args.limit),
      });
    return {
      items: page.page.map(memberSnapshot),
      cursor: page.isDone ? null : page.continueCursor,
      done: page.isDone,
    };
  },
});

export const listOfficialPublisherSnapshotPageInternal = internalQuery({
  args: { cursor: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("officialPublishers")
      .order("asc")
      .paginate({
        cursor: args.cursor ?? null,
        numItems: pageSize(args.limit),
      });
    return {
      items: page.page.map(officialSnapshot),
      cursor: page.isDone ? null : page.continueCursor,
      done: page.isDone,
    };
  },
});

export const getPublisherAvatarSourceInternal = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    const url = await ctx.storage.getUrl(args.storageId);
    if (!metadata || !url || !metadata.contentType?.startsWith("image/")) return null;
    return {
      storageId: args.storageId,
      url,
      contentType: metadata.contentType,
      sizeBytes: metadata.size,
      accessScope: "public" as const,
    };
  },
});

export const getPublisherUserFactsInternal = internalQuery({
  args: { legacyUserIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    if (args.legacyUserIds.length > 250) throw new Error("Publisher user facts page exceeds 250 IDs");
    return await Promise.all(
      args.legacyUserIds.map(async (legacyUserId) => {
        const userId = ctx.db.normalizeId("users", legacyUserId);
        const user = userId ? await ctx.db.get(userId) : null;
        return {
          legacyUserId,
          active: Boolean(user && !user.deletedAt && !user.deactivatedAt),
          platformRole: user?.role ?? null,
        };
      }),
    );
  },
});
