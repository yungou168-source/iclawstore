import type {
  SkillPackageAggregateSnapshot,
  SkillPackageMigrationSource,
  SkillPackageTargetRepository,
} from './skillPackageMigrationPort.js';
import { reconcileSkillPackageAggregates, type SkillPackageReconciliationDifference } from './skillPackageReconciliation.js';
import type { SkillPackageReconciliationCheckpoint } from './skillPackageReconciliationCheckpointRepository.js';

export type SkillPackageReconciliationSink = Readonly<{
  record: (input: SkillPackageReconciliationDifference & Readonly<{
    batchId: string;
    domain: string;
  }>) => Promise<void>;
}>;

export type SkillPackageReconciliationPageCheckpoint = Pick<
  SkillPackageReconciliationCheckpoint,
  'sourceCursor' | 'completed' | 'sourceExhausted'
>;

const recordDifferences = async (
  sink: SkillPackageReconciliationSink,
  batchId: string,
  domain: string,
  differences: readonly SkillPackageReconciliationDifference[],
): Promise<void> => {
  for (const difference of differences) await sink.record({ ...difference, batchId, domain });
};

export const reconcileSkillPackagePage = async (input: Readonly<{
  batchId: string;
  domain: 'skill' | 'package';
  source: readonly SkillPackageAggregateSnapshot[];
  target: readonly SkillPackageAggregateSnapshot[];
  sink: SkillPackageReconciliationSink;
}>): Promise<number> => {
  const differences = reconcileSkillPackageAggregates({ source: input.source, target: input.target });
  await recordDifferences(input.sink, input.batchId, `skill_package_${input.domain}`, differences);
  return differences.length;
};

/**
 * This runner is intentionally dependency-injected and unregistered. The caller
 * commits each completed page atomically with its differences before it advances
 * the checkpoint; no import, connection, or cutover is initiated here.
 */
export const runSkillPackageReconciliationPages = async (input: Readonly<{
  batchId: string;
  domain: 'skill' | 'package';
  checkpoint: SkillPackageReconciliationPageCheckpoint | null;
  source: SkillPackageMigrationSource;
  target: Pick<SkillPackageTargetRepository, 'listAggregates'>;
  pageSize: number;
  sink: SkillPackageReconciliationSink;
  commitPage: (input: Readonly<{
    source: readonly SkillPackageAggregateSnapshot[];
    target: readonly SkillPackageAggregateSnapshot[];
    nextCursor: string | null;
    done: boolean;
    differences: number;
  }>) => Promise<void>;
  finalize: () => Promise<void>;
}>): Promise<void> => {
  if (input.checkpoint?.completed) return;
  if (input.checkpoint?.sourceExhausted) return input.finalize();
  let sourceCursor = input.checkpoint?.sourceCursor ?? null;
  let targetCursor: string | null = null;
  const targets = new Map<string, SkillPackageAggregateSnapshot>();
  do {
    const targetPage = await input.target.listAggregates({ domain: input.domain, cursor: targetCursor, limit: input.pageSize });
    for (const aggregate of targetPage.items) targets.set(aggregate.legacyConvexId, aggregate);
    if (targetPage.done) break;
    if (!targetPage.cursor) throw new Error('skill_package_target_page_incomplete_without_cursor');
    targetCursor = targetPage.cursor;
  } while (true);
  do {
    const sourcePage = await input.source.listAggregates({ domain: input.domain, cursor: sourceCursor, limit: input.pageSize });
    const targetPage = sourcePage.items.flatMap((aggregate) => {
      const target = targets.get(aggregate.legacyConvexId);
      if (target) targets.delete(aggregate.legacyConvexId);
      return target ? [target] : [];
    });
    const differences = await reconcileSkillPackagePage({
      batchId: input.batchId, domain: input.domain, source: sourcePage.items, target: targetPage, sink: input.sink,
    });
    await input.commitPage({ source: sourcePage.items, target: targetPage, nextCursor: sourcePage.cursor,
      done: sourcePage.done, differences });
    if (sourcePage.done) break;
    if (!sourcePage.cursor) throw new Error('skill_package_source_page_incomplete_without_cursor');
    sourceCursor = sourcePage.cursor;
  } while (true);
  if (targets.size > 0) {
    const differences = await reconcileSkillPackagePage({
      batchId: input.batchId, domain: input.domain, source: [], target: [...targets.values()], sink: input.sink,
    });
    await input.commitPage({ source: [], target: [...targets.values()], nextCursor: null, done: true, differences });
  }
  await input.finalize();
};