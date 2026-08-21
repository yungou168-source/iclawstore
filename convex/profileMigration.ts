import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { internalQuery } from './functions';

const pageSize = (value: number | undefined) => Math.max(1, Math.min(value ?? 100, 250));

const profileAliases = async (ctx: Pick<QueryCtx, 'db'>, userId: Id<'users'>) => {
  const aliases = await ctx.db
    .query('profileIdentityAliases')
    .withIndex('by_user_and_alias_kind', (query) => query.eq('userId', userId))
    .collect();
  return aliases.map((alias) => ({
    aliasKind: alias.aliasKind,
    aliasValue: alias.aliasValue,
    isCanonical: alias.isCanonical,
    retiredAt: alias.retiredAt ?? null,
  }));
};

const profileSnapshot = (user: {
  _id: Id<'users'>;
  _creationTime: number;
  name?: string;
  handle?: string;
  profileSlug?: string;
  displayName?: string;
  bio?: string;
  image?: string;
  imageStorageId?: string;
  developerStatus?: 'approved';
  developerAppliedAt?: number;
  developerApprovedAt?: number;
  role?: 'admin' | 'moderator' | 'user';
  trustedPublisher?: boolean;
  publishedSkills?: number;
  totalStars?: number;
  totalDownloads?: number;
  personalPublisherId?: string;
  deletedAt?: number;
  deactivatedAt?: number;
  purgedAt?: number;
  banReason?: string;
  createdAt?: number;
  updatedAt?: number;
}) => ({
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
});

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
      items: await Promise.all(page.page.map(async (user) => ({
        ...profileSnapshot(user),
        aliases: await profileAliases(ctx, user._id),
      }))),
      cursor: page.isDone ? null : page.continueCursor,
      done: page.isDone,
    };
  },
});

export const getProfileAvatarSourceInternal = internalQuery({
  args: { storageId: v.id('_storage') },
  handler: async (ctx, args) => {
    const metadata = await ctx.db.system.get('_storage', args.storageId);
    const url = await ctx.storage.getUrl(args.storageId);
    if (!metadata || !url || !metadata.contentType?.startsWith('image/')) return null;
    return {
      storageId: args.storageId,
      url,
      contentType: metadata.contentType,
      sizeBytes: metadata.size,
      accessScope: 'public' as const,
    };
  },
});

/**
 * Reads a stable profile-change window. The caller owns the returned watermark:
 * every continuation must reuse it, so source updates after the first page are
 * intentionally deferred to the next overlapping synchronization window.
 */
export const listProfileIncrementalPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
    updatedAfter: v.number(),
    updatedBefore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const watermark = args.updatedBefore ?? Date.now();
    if (args.updatedAfter > watermark) {
      throw new Error('updatedAfter must not be greater than updatedBefore');
    }
    const page = await ctx.db
      .query('users')
      .withIndex('by_updated_at', (q) =>
        q.gte('updatedAt', args.updatedAfter).lte('updatedAt', watermark),
      )
      .order('asc')
      .paginate({ cursor: args.cursor ?? null, numItems: pageSize(args.limit) });
    return {
      items: await Promise.all(page.page.map(async (user) => ({
        ...profileSnapshot(user),
        aliases: await profileAliases(ctx, user._id),
      }))),
      cursor: page.isDone ? null : page.continueCursor,
      done: page.isDone,
      watermark,
    };
  },
});