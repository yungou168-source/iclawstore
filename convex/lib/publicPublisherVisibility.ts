import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export type PublicPublisherVisibility = Readonly<{
  publisher: Doc<'publishers'>;
  linkedUser: Doc<'users'> | null;
}>;

export async function getLegacyPersonalPublisherOwner(
  ctx: Pick<QueryCtx, 'db'>,
  publisherId: Id<'publishers'>,
): Promise<Doc<'users'> | null> {
  const memberships = await ctx.db
    .query('publisherMembers')
    .withIndex('by_publisher', (q) => q.eq('publisherId', publisherId))
    .collect();
  for (const membership of memberships) {
    if (membership.role !== 'owner') continue;
    const user = await ctx.db.get(membership.userId);
    if (user && !user.deletedAt && !user.deactivatedAt) return user;
  }
  return null;
}

export async function getPublicPublisherVisibility(
  ctx: Pick<QueryCtx, 'db'>,
  publisher: Doc<'publishers'> | null | undefined,
): Promise<PublicPublisherVisibility | null> {
  if (!publisher || publisher.deletedAt || publisher.deactivatedAt) return null;
  if (publisher.kind !== 'user') return { publisher, linkedUser: null };
  if (!publisher.linkedUserId) {
    const legacyOwner = await getLegacyPersonalPublisherOwner(ctx, publisher._id);
    return legacyOwner ? { publisher, linkedUser: legacyOwner } : null;
  }

  const linkedUser = await ctx.db.get(publisher.linkedUserId);
  if (!linkedUser || linkedUser.deletedAt || linkedUser.deactivatedAt) return null;
  return { publisher, linkedUser };
}