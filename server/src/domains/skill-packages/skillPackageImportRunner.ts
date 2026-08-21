import type {
  SkillPackageMigrationSource,
  SkillPackageTargetRepository,
} from './skillPackageMigrationPort.js';

export const importSkillPackagePage = async (input: Readonly<{
  batchId: string;
  domain: 'skill' | 'package';
  cursor: string | null;
  batchSize: number;
  source: SkillPackageMigrationSource;
  target: SkillPackageTargetRepository;
}>) => {
  const sourcePage = await input.source.listAggregates({
    domain: input.domain,
    cursor: input.cursor,
    limit: input.batchSize,
  });
  const result = await input.target.importPage({
    batchId: input.batchId,
    domain: input.domain,
    items: sourcePage.items,
    nextCursor: sourcePage.cursor,
    done: sourcePage.done,
  });
  return Object.freeze({
    ...result,
    cursor: sourcePage.cursor,
    done: sourcePage.done,
    sourceCount: sourcePage.items.length,
  });
};