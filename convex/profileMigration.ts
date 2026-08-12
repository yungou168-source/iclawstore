import { v } from 'convex/values';
import { internalQuery } from './functions';

const pageSize = (value: number | undefined) => Math.max(1, Math.min(value ?? 100, 250));

export const listProfileSnapshotPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db.query('users').order('asc').paginate({
      cursor: args.cursor ?? null,
      numItems: pageSize(args.limit),
    });
    return {
      items: page.page.map((user) => ({
        legacyConvexId: user._id,
        legacyCreationTime: user._creationTime,
        name: user.name ?? null,
        handle: user.handle ?? null,
        profileSlug: user.profileSlug ?? null,
        displayName: user.displayName ?? null,
        bio: user.bio ?? null,
        image: user.image ?? null,
        imageStorageId: user.imageStorageId ?? null,
        developerStatus: user.developerStatus ?? null,
        developerAppliedAt: user.developerAppliedAt ?? null,
        developerApprovedAt: user.developerApprovedAt ?? null,
        role: user.role ?? null,
        trustedPublisher: user.trustedPublisher ?? false,
        publishedSkills: user.publishedSkills ?? 0,
        totalStars: user.totalStars ?? 0,
        totalDownloads: user.totalDownloads ?? 0,
        personalPublisherLegacyConvexId: user.personalPublisherId ?? null,
        deletedAt: user.deletedAt ?? null,
        deactivatedAt: user.deactivatedAt ?? null,
        purgedAt: user.purgedAt ?? null,
        banReason: user.banReason ?? null,
        legacyCreatedAt: user.createdAt ?? null,
        legacyUpdatedAt: user.updatedAt ?? null,
      })),
      cursor: page.isDone ? null : page.continueCursor,
      done: page.isDone,
    };
  },
});