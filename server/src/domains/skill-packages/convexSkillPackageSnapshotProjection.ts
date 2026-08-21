import type { SkillPackageAggregateSnapshot, SkillPackageDomain, SkillPackageSourcePage } from './skillPackageMigrationPort.js';

export type SkillPackageConvexSnapshotProjection = Readonly<{
  listAggregates: (input: Readonly<{ domain: SkillPackageDomain; cursor: string | null; limit: number }>) => Promise<SkillPackageSourcePage<SkillPackageAggregateSnapshot>>;
}>;

export const createSkillPackageConvexSnapshotProjection = (input: Readonly<{
  listSkill: (args: Readonly<{ cursor?: string; limit: number }>) => Promise<SkillPackageSourcePage<SkillPackageAggregateSnapshot>>;
  listPackage: (args: Readonly<{ cursor?: string; limit: number }>) => Promise<SkillPackageSourcePage<SkillPackageAggregateSnapshot>>;
}>): SkillPackageConvexSnapshotProjection => Object.freeze({
  listAggregates: ({ domain, cursor, limit }) => domain === 'skill'
    ? input.listSkill({ cursor: cursor ?? undefined, limit })
    : input.listPackage({ cursor: cursor ?? undefined, limit }),
});

export const createFakeSkillPackageSnapshotProjection = (items: readonly SkillPackageAggregateSnapshot[]): SkillPackageConvexSnapshotProjection => Object.freeze({
  listAggregates: async ({ domain, cursor, limit }) => {
    const filtered = items.filter((item) => item.domain === domain);
    const start = cursor ? Number(cursor) : 0;
    const page = filtered.slice(start, start + limit);
    const next = start + page.length;
    return { items: page, cursor: next < filtered.length ? String(next) : null, done: next >= filtered.length };
  },
});