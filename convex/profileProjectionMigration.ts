import type { Id } from './_generated/dataModel';
import { v } from 'convex/values';
import { internalQuery } from './functions';
import { getPublicPublisherVisibility } from './lib/publicPublisherVisibility';
import { readCanonicalStat } from './lib/skillStats';

const pageSize = (value: number | undefined) => Math.max(1, Math.min(value ?? 100, 250));

type Phase = 'skills' | 'packages' | 'stars' | 'manifests';
type Cursor = Readonly<{ phase: Phase; cursor: string | null }>;

export const decodeProfileProjectionSourceCursor = (
  value: string | undefined,
  phase: Phase,
): Cursor => {
  if (!value) return { phase, cursor: null };
  try {
    const parsed = JSON.parse(value) as Partial<Cursor>;
    if (parsed.phase !== phase || (parsed.cursor !== null && typeof parsed.cursor !== 'string')) {
      throw new Error('invalid');
    }
    return { phase, cursor: parsed.cursor ?? null };
  } catch {
    throw new Error('Profile projection source cursor is invalid');
  }
};

const nextCursor = (phase: Phase, page: Readonly<{ isDone: boolean; continueCursor: string }>) =>
  page.isDone ? null : JSON.stringify({ phase, cursor: page.continueCursor });

const catalogItem = (
  item: Readonly<{
    _id: string;
    kind: 'skill' | 'plugin';
    slug?: string;
    displayName: string;
    summary?: string;
    icon?: string;
    href: string;
    downloads: number;
    stars: number;
    isOfficial: boolean;
    updatedAt: number;
    sourceGitHubId?: string;
    sourcePath?: string;
  }>,
) => ({
  legacyConvexId: item._id,
  kind: item.kind,
  slug: item.slug ?? null,
  displayName: item.displayName,
  summary: item.summary ?? null,
  icon: item.icon ?? null,
  href: item.href,
  canonicalStats: { downloads: item.downloads, stars: item.stars },
  isOfficial: item.isOfficial,
  updatedAt: item.updatedAt,
  sourceGitHubId: item.sourceGitHubId ?? null,
  sourcePath: item.sourcePath ?? null,
});

const isPublicSkill = (skill: Readonly<{ softDeletedAt?: number; moderationStatus?: string }>) =>
  !skill.softDeletedAt && (!skill.moderationStatus || skill.moderationStatus === 'active');

const publisherOfficial = async (
  ctx: Parameters<typeof getPublicPublisherVisibility>[0],
  publisherId: Id<'publishers'>,
) =>
  Boolean(
    await ctx.db
      .query('officialPublishers')
      .withIndex('by_publisher', (q) => q.eq('publisherId', publisherId))
      .unique(),
  );

const starredItem = (
  viewerUserLegacyConvexId: string,
  starredAt: number,
  item: ReturnType<typeof catalogItem>,
) => ({ viewerUserLegacyConvexId, starredAt, item });

export const listStarredSnapshotPageInternal = internalQuery({
  args: { cursor: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const state = decodeProfileProjectionSourceCursor(args.cursor, 'stars');
    const page = await ctx.db
      .query('stars')
      .withIndex('by_user_createdAt')
      .order('asc')
      .paginate({
        cursor: state.cursor,
        numItems: pageSize(args.limit),
      });
    const items = await Promise.all(
      page.page.map(async (star) => {
        const viewer = await ctx.db.get(star.userId);
        const skill = await ctx.db.get(star.skillId);
        if (!viewer || viewer.deletedAt || viewer.deactivatedAt || !skill || !isPublicSkill(skill)) {
          return null;
        }
        if (!skill.ownerPublisherId) return null;
        const ownerPublisher = await ctx.db.get(skill.ownerPublisherId);
        const visibleOwner = await getPublicPublisherVisibility(ctx, ownerPublisher);
        if (!visibleOwner) return null;
        const official = await publisherOfficial(ctx, visibleOwner.publisher._id);
        return starredItem(
          String(viewer._id),
          star.createdAt,
          catalogItem({
            _id: String(skill._id), kind: 'skill', slug: skill.slug, displayName: skill.displayName,
            summary: skill.summary, icon: skill.icon,
            href: `/${encodeURIComponent(visibleOwner.publisher.handle)}/${encodeURIComponent(skill.slug)}`,
            downloads: readCanonicalStat(skill, 'downloads'), stars: readCanonicalStat(skill, 'stars'),
            isOfficial: official || Boolean(skill.badges?.official), updatedAt: skill.updatedAt,
            sourceGitHubId: skill.githubSourceId, sourcePath: skill.githubPath,
          }),
        );
      }),
    );
    return { items: items.filter(Boolean), cursor: nextCursor('stars', page), done: page.isDone };
  },
});

const manifestStatus = (status: 'ok' | 'missing' | 'invalid' | 'failed' | undefined) =>
  status ?? 'missing';

export const listManifestSnapshotPageInternal = internalQuery({
  args: { cursor: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const state = decodeProfileProjectionSourceCursor(args.cursor, 'manifests');
    const page = await ctx.db
      .query('githubSkillSources')
      .withIndex('by_updated')
      .order('asc')
      .paginate({
        cursor: state.cursor,
        numItems: pageSize(args.limit),
      });
    const items = await Promise.all(
      page.page.map(async (source) => {
        if (!source.ownerPublisherId) return null;
        const publisher = await ctx.db.get(source.ownerPublisherId);
        const visible = await getPublicPublisherVisibility(ctx, publisher);
        if (!visible) return null;
        const status = manifestStatus(source.displayManifestStatus);
        const groupings = status === 'ok' ? source.displayManifest?.groupings ?? [] : [];
        return {
          sourceGitHubLegacyConvexId: String(source._id),
          publisherLegacyConvexId: String(visible.publisher._id),
          repo: source.repo,
          status,
          verifiedCommit: source.displayManifestCommit ?? null,
          notGrouped: status === 'ok' ? source.displayManifest?.notGrouped ?? null : null,
          updatedAt: source.updatedAt,
          sections: groupings.map((group, sectionPosition) => ({
            position: sectionPosition,
            title: group.title,
            description: group.description ?? null,
            entries: group.skills.map((skillKey, entryPosition) => ({
              position: entryPosition,
              skillKey,
            })),
          })),
        };
      }),
    );
    return { items: items.filter(Boolean), cursor: nextCursor('manifests', page), done: page.isDone };
  },
});

export const listPackageSnapshotPageInternal = internalQuery({
  args: { cursor: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const state = decodeProfileProjectionSourceCursor(args.cursor, 'packages');
    const page = await ctx.db
      .query('packages')
      .withIndex('by_active_updated', (q) => q.eq('softDeletedAt', undefined))
      .order('asc')
      .paginate({
        cursor: state.cursor,
        numItems: pageSize(args.limit),
      });
    const items = await Promise.all(
      page.page.map(async (pkg) => {
        if (!pkg.ownerPublisherId) return null;
        const publisher = await ctx.db.get(pkg.ownerPublisherId);
        const visible = await getPublicPublisherVisibility(ctx, publisher);
        if (!visible) return null;
        const official = await publisherOfficial(ctx, visible.publisher._id);
        return {
          publisherLegacyConvexId: String(visible.publisher._id),
          publisherHandle: visible.publisher.handle,
          item: catalogItem({
            _id: String(pkg._id),
            kind: pkg.family === 'skill' ? 'skill' : 'plugin',
            displayName: pkg.displayName,
            summary: pkg.summary,
            href: `/plugins/${encodeURIComponent(pkg.name)}`,
            downloads: pkg.stats.downloads,
            stars: pkg.stats.stars,
            isOfficial: official || pkg.isOfficial,
            updatedAt: pkg.updatedAt,
          }),
        };
      }),
    );
    return { items: items.filter(Boolean), cursor: nextCursor('packages', page), done: page.isDone };
  },
});

export const listCatalogSnapshotPageInternal = internalQuery({
  args: { cursor: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const state = decodeProfileProjectionSourceCursor(args.cursor, 'skills');
    const page = await ctx.db
      .query('skills')
      .withIndex('by_active_updated', (q) => q.eq('softDeletedAt', undefined))
      .order('asc')
      .paginate({
      cursor: state.cursor,
      numItems: pageSize(args.limit),
    });
    const items = await Promise.all(
      page.page.map(async (skill) => {
        if (!isPublicSkill(skill) || !skill.ownerPublisherId) return null;
        const publisher = await ctx.db.get(skill.ownerPublisherId);
        const visible = await getPublicPublisherVisibility(ctx, publisher);
        if (!visible) return null;
        const official = await publisherOfficial(ctx, visible.publisher._id);
        return {
          publisherLegacyConvexId: String(visible.publisher._id),
          publisherHandle: visible.publisher.handle,
          item: catalogItem({
            _id: String(skill._id), kind: 'skill', slug: skill.slug, displayName: skill.displayName,
            summary: skill.summary, icon: skill.icon,
            href: `/${encodeURIComponent(visible.publisher.handle)}/${encodeURIComponent(skill.slug)}`,
            downloads: readCanonicalStat(skill, 'downloads'), stars: readCanonicalStat(skill, 'stars'),
            isOfficial: official || Boolean(skill.badges?.official), updatedAt: skill.updatedAt,
            sourceGitHubId: skill.githubSourceId, sourcePath: skill.githubPath,
          }),
        };
      }),
    );
    return { items: items.filter(Boolean), cursor: nextCursor('skills', page), done: page.isDone };
  },
});