import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { internalQuery } from './functions';
import { sha256Hex } from './lib/clawpack';

const pageSize = (value: number | undefined) => Math.max(1, Math.min(value ?? 100, 250));

const stableValue = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableValue(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

const snapshotHash = async (value: unknown) =>
  sha256Hex(new TextEncoder().encode(stableValue(value)));

const artifactSnapshot = (file: {
  storageId: string;
  path: string;
  size: number;
  sha256: string;
  contentType?: string;
}) => ({
  legacyStorageId: file.storageId,
  path: file.path,
  mimeType: file.contentType ?? 'application/octet-stream',
  sizeBytes: file.size,
  sha256: file.sha256,
});

const scanSnapshot = (version: Pick<
  Doc<'skillVersions'> | Doc<'packageReleases'>,
  'staticScan' | 'vtAnalysis' | 'skillSpectorAnalysis' | 'llmAnalysis'
>) => ({
  static: version.staticScan ?? null,
  virusTotal: version.vtAnalysis ?? null,
  skillSpector: version.skillSpectorAnalysis ?? null,
  llm: version.llmAnalysis ?? null,
});

const listSkillVersionSnapshots = async (ctx: Pick<QueryCtx, 'db'>, skillId: Id<'skills'>) => {
  const versions = await ctx.db
    .query('skillVersions')
    .withIndex('by_skill', (query) => query.eq('skillId', skillId))
    .collect();

  return await Promise.all(versions.map(async (version) => {
    const artifacts = version.files.map(artifactSnapshot);
    const sourceMetadata = {
      fingerprint: version.fingerprint ?? null,
      provenance: version.sourceProvenance ?? null,
      changelog: version.changelog,
      changelogSource: version.changelogSource ?? null,
      parsed: version.parsed,
      capabilityTags: version.capabilityTags ?? [],
      softDeletedAt: version.softDeletedAt ?? null,
    };
    const scan = scanSnapshot(version);
    return {
      legacyConvexId: version._id,
      semanticVersion: version.version,
      sourceHash: await snapshotHash({ sourceMetadata, scan, artifacts }),
      sourceMetadata,
      scanSnapshot: scan,
      legacyCreatedAt: version.createdAt,
      legacyUpdatedAt: version._creationTime,
      artifacts,
    };
  }));
};

const listPackageReleaseSnapshots = async (
  ctx: Pick<QueryCtx, 'db'>,
  packageId: Id<'packages'>,
) => {
  const releases = await ctx.db
    .query('packageReleases')
    .withIndex('by_package', (query) => query.eq('packageId', packageId))
    .collect();

  return await Promise.all(releases.map(async (release) => {
    const artifacts = release.files.map(artifactSnapshot);
    if (release.clawpackStorageId && release.clawpackSha256 && release.clawpackSize !== undefined) {
      artifacts.push({
        legacyStorageId: release.clawpackStorageId,
        path: release.npmTarballName ?? `${release.version}.tgz`,
        mimeType: 'application/gzip',
        sizeBytes: release.clawpackSize,
        sha256: release.clawpackSha256,
      });
    }
    const sourceMetadata = {
      changelog: release.changelog,
      summary: release.summary ?? null,
      distTags: release.distTags,
      integritySha256: release.integritySha256,
      artifactKind: release.artifactKind ?? null,
      source: release.source ?? null,
      sourceRepo: release.sourceRepo ?? null,
      compatibility: release.compatibility ?? null,
      capabilities: release.capabilities ?? null,
      runtimeId: release.runtimeId ?? null,
      verification: release.verification ?? null,
      softDeletedAt: release.softDeletedAt ?? null,
    };
    const scan = scanSnapshot(release);
    return {
      legacyConvexId: release._id,
      semanticVersion: release.version,
      sourceHash: await snapshotHash({ sourceMetadata, scan, artifacts }),
      sourceMetadata,
      scanSnapshot: scan,
      legacyCreatedAt: release.createdAt,
      legacyUpdatedAt: release._creationTime,
      artifacts,
    };
  }));
};

export const listSkillSnapshotPageInternal = internalQuery({
  args: { cursor: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query('skills').order('asc').paginate({
      cursor: args.cursor ?? null,
      numItems: pageSize(args.limit),
    });
    const items = await Promise.all(page.page.map(async (skill) => {
      const versions = await listSkillVersionSnapshots(ctx, skill._id);
      const metadata = {
        icon: skill.icon ?? null,
        resourceId: skill.resourceId ?? null,
        ownerUserLegacyConvexId: skill.ownerUserId,
        softDeletedAt: skill.softDeletedAt ?? null,
        moderation: {
          status: skill.moderationStatus,
          verdict: skill.moderationVerdict ?? null,
          reason: skill.moderationReason ?? null,
          reasonCodes: skill.moderationReasonCodes ?? [],
          summary: skill.moderationSummary ?? null,
        },
        github: {
          sourceLegacyConvexId: skill.githubSourceId ?? null,
          path: skill.githubPath ?? null,
          commit: skill.githubCurrentCommit ?? null,
          contentHash: skill.githubCurrentContentHash ?? null,
          status: skill.githubCurrentStatus ?? null,
        },
        capabilityTags: skill.capabilityTags ?? [],
      };
      return {
        domain: 'skill' as const,
        legacyConvexId: skill._id,
        ownerPublisherLegacyConvexId: skill.ownerPublisherId ?? null,
        canonicalName: skill.slug,
        displayName: skill.displayName,
        summary: skill.summary ?? null,
        visibility: skill.softDeletedAt ? 'deleted' as const : 'public' as const,
        metadata,
        legacyUpdatedAt: skill.updatedAt,
        sourceHash: await snapshotHash({ metadata, versions }),
        versions,
      };
    }));
    return { items, cursor: page.isDone ? null : page.continueCursor, done: page.isDone };
  },
});

export const listPackageSnapshotPageInternal = internalQuery({
  args: { cursor: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query('packages').order('asc').paginate({
      cursor: args.cursor ?? null,
      numItems: pageSize(args.limit),
    });
    const items = await Promise.all(page.page.map(async (pkg) => {
      const versions = await listPackageReleaseSnapshots(ctx, pkg._id);
      const metadata = {
        normalizedName: pkg.normalizedName,
        ownerUserLegacyConvexId: pkg.ownerUserId,
        family: pkg.family,
        channel: pkg.channel,
        isOfficial: pkg.isOfficial,
        runtimeId: pkg.runtimeId ?? null,
        sourceRepo: pkg.sourceRepo ?? null,
        compatibility: pkg.compatibility ?? null,
        capabilities: pkg.capabilities ?? null,
        verification: pkg.verification ?? null,
        scanStatus: pkg.scanStatus,
        softDeletedAt: pkg.softDeletedAt ?? null,
      };
      return {
        domain: 'package' as const,
        legacyConvexId: pkg._id,
        ownerPublisherLegacyConvexId: pkg.ownerPublisherId ?? null,
        canonicalName: pkg.name,
        displayName: pkg.displayName,
        summary: pkg.summary ?? null,
        visibility: pkg.softDeletedAt ? 'deleted' as const : 'public' as const,
        metadata,
        legacyUpdatedAt: pkg.updatedAt,
        sourceHash: await snapshotHash({ metadata, versions }),
        versions,
      };
    }));
    return { items, cursor: page.isDone ? null : page.continueCursor, done: page.isDone };
  },
});