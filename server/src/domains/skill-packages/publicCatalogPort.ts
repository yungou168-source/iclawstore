import { Prisma, type PrismaClient } from '@prisma/client';

export type CatalogDomain = 'skill' | 'package';

export type CatalogOwner = Readonly<{
  id: string;
  handle: string | null;
  displayName: string | null;
  image: string | null;
}>;

export type CatalogPublisher = Readonly<{
  id: string;
  handle: string;
  displayName: string;
  image: string | null;
}>;

export type CatalogArtifact = Readonly<{
  path: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  available: false;
}>;

export type CatalogVersion = Readonly<{
  id: string;
  version: string;
  createdAt: string;
  changelog: string;
  sha256: string | null;
  artifacts: readonly CatalogArtifact[];
}>;

export type CatalogEntry = Readonly<{
  id: string;
  name: string;
  displayName: string;
  summary: string | null;
  owner: CatalogOwner;
  publisher: CatalogPublisher | null;
  latestVersion: CatalogVersion | null;
  updatedAt: string;
  tags: readonly string[];
  stats: Readonly<Record<string, number>>;
}>;

export type CatalogPage = Readonly<{
  items: readonly CatalogEntry[];
  pagination: Readonly<{ page: number; limit: number; total: number; pages: number }>;
}>;

export type PublicCatalogPort = Readonly<{
  list: (input: Readonly<{ domain: CatalogDomain; page: number; limit: number; sort: string }>) => Promise<CatalogPage>;
  resolve: (input: Readonly<{ domain: CatalogDomain; name: string }>) => Promise<CatalogEntry | null>;
  getById: (input: Readonly<{ domain: CatalogDomain; id: string }>) => Promise<CatalogEntry | null>;
  listVersions: (input: Readonly<{ domain: CatalogDomain; id: string; page: number; limit: number }>) => Promise<Readonly<{ versions: readonly CatalogVersion[]; total: number }>|null>;
  getVersion: (input: Readonly<{ domain: CatalogDomain; id: string; version: string }>) => Promise<CatalogVersion | null>;
}>;

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const stringArray = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const numericRecord = (value: unknown): Record<string, number> =>
  Object.fromEntries(Object.entries(asRecord(value)).filter(([, item]) => typeof item === 'number')) as Record<string, number>;

const owner = (value: { id: string; handle: string | null; displayName: string | null; image: string | null }): CatalogOwner => value;

const publisher = (value: { id: string; handle: string; displayName: string; image: string | null } | null): CatalogPublisher | null => value;

const skillVersion = (value: { id: string; version: string; createdAt: Date; changelog: string; sha256hash: string | null; files: unknown }): CatalogVersion => ({
  id: value.id,
  version: value.version,
  createdAt: value.createdAt.toISOString(),
  changelog: value.changelog,
  sha256: value.sha256hash,
  artifacts: stringArray(value.files).map((path) => ({ path, mimeType: 'application/octet-stream', sizeBytes: 0, sha256: '', available: false })),
});

const packageVersion = (value: { id: string; version: string; createdAt: Date; changelog: string; integritySha256: string; files: unknown }): CatalogVersion => ({
  id: value.id,
  version: value.version,
  createdAt: value.createdAt.toISOString(),
  changelog: value.changelog,
  sha256: value.integritySha256,
  artifacts: stringArray(value.files).map((path) => ({ path, mimeType: 'application/octet-stream', sizeBytes: 0, sha256: '', available: false })),
});

const visibleSkill: Prisma.skillsWhereInput = {
  softDeletedAt: null,
  AND: [
    { OR: [{ moderationStatus: null }, { moderationStatus: { notIn: ['hidden', 'removed'] } }] },
    { OR: [{ moderationVerdict: null }, { moderationVerdict: { not: 'malicious' } }] },
    { OR: [{ githubScanStatus: null }, { githubScanStatus: { not: 'malicious' } }] },
  ],
};

const visiblePackage: Prisma.packagesWhereInput = { softDeletedAt: null, scanStatus: 'clean' };

const skillIncludes = {
  owner: { select: { id: true, handle: true, displayName: true, image: true } },
  publisher: { select: { id: true, handle: true, displayName: true, image: true } },
  versions: { orderBy: { createdAt: 'desc' }, take: 1 },
} satisfies Prisma.skillsInclude;

const packageIncludes = {
  owner: { select: { id: true, handle: true, displayName: true, image: true } },
  publisher: { select: { id: true, handle: true, displayName: true, image: true } },
  releases: { orderBy: { createdAt: 'desc' }, take: 1 },
} satisfies Prisma.packagesInclude;

export const createMysqlPublicCatalogPort = (prisma: PrismaClient): PublicCatalogPort => Object.freeze({
  list: async ({ domain, page, limit, sort }) => {
    const skip = (page - 1) * limit;
    if (domain === 'skill') {
      const orderBy: Prisma.skillsOrderByWithRelationInput = sort === 'stars' ? { statsStars: 'desc' } : sort === 'installs' ? { statsInstallsAllTime: 'desc' } : sort === 'created' ? { createdAt: 'desc' } : { statsDownloads: 'desc' };
      const [rows, total] = await Promise.all([
        prisma.skills.findMany({ where: visibleSkill, include: skillIncludes, orderBy, skip, take: limit }),
        prisma.skills.count({ where: visibleSkill }),
      ]);
      return {
        items: rows.map((row) => ({ id: row.id, name: row.slug, displayName: row.displayName, summary: row.summary, owner: owner(row.owner), publisher: publisher(row.publisher), latestVersion: row.versions[0] ? skillVersion(row.versions[0]) : null, updatedAt: row.updatedAt.toISOString(), tags: stringArray(row.tags), stats: { downloads: row.statsDownloads, stars: row.statsStars, installsCurrent: row.statsInstallsCurrent, installsAllTime: row.statsInstallsAllTime } })),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      };
    }
    const orderBy: Prisma.packagesOrderByWithRelationInput = sort === 'created' ? { createdAt: 'desc' } : { updatedAt: 'desc' };
    const [rows, total] = await Promise.all([
      prisma.packages.findMany({ where: visiblePackage, include: packageIncludes, orderBy, skip, take: limit }),
      prisma.packages.count({ where: visiblePackage }),
    ]);
    return {
      items: rows.map((row) => ({ id: row.id, name: row.normalizedName, displayName: row.displayName, summary: row.summary, owner: owner(row.owner), publisher: publisher(row.publisher), latestVersion: row.releases[0] ? packageVersion(row.releases[0]) : null, updatedAt: row.updatedAt.toISOString(), tags: stringArray(row.tags), stats: numericRecord(row.stats) })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  },
  resolve: async ({ domain, name }) => {
    if (domain === 'skill') {
      const row = await prisma.skills.findFirst({ where: { ...visibleSkill, slug: name }, include: skillIncludes });
      return row ? { id: row.id, name: row.slug, displayName: row.displayName, summary: row.summary, owner: owner(row.owner), publisher: publisher(row.publisher), latestVersion: row.versions[0] ? skillVersion(row.versions[0]) : null, updatedAt: row.updatedAt.toISOString(), tags: stringArray(row.tags), stats: { downloads: row.statsDownloads, stars: row.statsStars, installsCurrent: row.statsInstallsCurrent, installsAllTime: row.statsInstallsAllTime } } : null;
    }
    const row = await prisma.packages.findFirst({ where: { ...visiblePackage, normalizedName: name }, include: packageIncludes });
    return row ? { id: row.id, name: row.normalizedName, displayName: row.displayName, summary: row.summary, owner: owner(row.owner), publisher: publisher(row.publisher), latestVersion: row.releases[0] ? packageVersion(row.releases[0]) : null, updatedAt: row.updatedAt.toISOString(), tags: stringArray(row.tags), stats: numericRecord(row.stats) } : null;
  },
  getById: async ({ domain, id }) => {
    if (domain === 'skill') {
      const row = await prisma.skills.findFirst({ where: { ...visibleSkill, id }, include: skillIncludes });
      return row ? { id: row.id, name: row.slug, displayName: row.displayName, summary: row.summary, owner: owner(row.owner), publisher: publisher(row.publisher), latestVersion: row.versions[0] ? skillVersion(row.versions[0]) : null, updatedAt: row.updatedAt.toISOString(), tags: stringArray(row.tags), stats: { downloads: row.statsDownloads, stars: row.statsStars, installsCurrent: row.statsInstallsCurrent, installsAllTime: row.statsInstallsAllTime } } : null;
    }
    const row = await prisma.packages.findFirst({ where: { ...visiblePackage, id }, include: packageIncludes });
    return row ? { id: row.id, name: row.normalizedName, displayName: row.displayName, summary: row.summary, owner: owner(row.owner), publisher: publisher(row.publisher), latestVersion: row.releases[0] ? packageVersion(row.releases[0]) : null, updatedAt: row.updatedAt.toISOString(), tags: stringArray(row.tags), stats: numericRecord(row.stats) } : null;
  },
  listVersions: async ({ domain, id, page, limit }) => {
    const visible = await (domain === 'skill' ? prisma.skills.findFirst({ where: { ...visibleSkill, id }, select: { id: true } }) : prisma.packages.findFirst({ where: { ...visiblePackage, id }, select: { id: true } }));
    if (!visible) return null;
    const skip = (page - 1) * limit;
    if (domain === 'skill') {
      const [rows, total] = await Promise.all([prisma.skillVersions.findMany({ where: { skillId: id, softDeletedAt: null }, orderBy: { createdAt: 'desc' }, skip, take: limit }), prisma.skillVersions.count({ where: { skillId: id, softDeletedAt: null } })]);
      return { versions: rows.map(skillVersion), total };
    }
    const [rows, total] = await Promise.all([prisma.packageReleases.findMany({ where: { packageId: id, softDeletedAt: null }, orderBy: { createdAt: 'desc' }, skip, take: limit }), prisma.packageReleases.count({ where: { packageId: id, softDeletedAt: null } })]);
    return { versions: rows.map(packageVersion), total };
  },
  getVersion: async ({ domain, id, version }) => {
    if (domain === 'skill') {
      const result = await prisma.skillVersions.findFirst({ where: { skillId: id, version, softDeletedAt: null, skill: visibleSkill } });
      return result ? skillVersion(result) : null;
    }
    const result = await prisma.packageReleases.findFirst({ where: { packageId: id, version, softDeletedAt: null, package: visiblePackage } });
    return result ? packageVersion(result) : null;
  },
});