import type {
  ProfileProjectionCatalogSourceSnapshot,
  ProfileProjectionMigrationSource,
  ProfileProjectionStarredSourceSnapshot,
} from './profileProjectionMigrationSource.js';
import type { ProfileProjectionManifestSource, ProfileProjectionSourcePage } from './profileProjectionPort.js';
import {
  reconcileProfileProjectionPhase,
  type ProfileProjectionReconciliationDifference,
  type ProfileProjectionReconciliationPhase,
} from './profileProjectionReconciliation.js';

type Snapshot = ProfileProjectionCatalogSourceSnapshot | ProfileProjectionStarredSourceSnapshot | ProfileProjectionManifestSource;

type Checkpoint = Readonly<{
  load: (batchId: string, phase: ProfileProjectionReconciliationPhase) => Promise<Readonly<{ sourceCursor: string | null; completed: boolean }> | null>;
  start: (batchId: string, phase: ProfileProjectionReconciliationPhase) => Promise<void>;
  advance: (input: Readonly<{ batchId: string; phase: ProfileProjectionReconciliationPhase; cursor: string | null; sourceCount: number; differenceCount: number; completed: boolean }>) => Promise<void>;
  fail: (batchId: string, phase: ProfileProjectionReconciliationPhase, failureCode: string) => Promise<void>;
}>;

type DifferenceSink = Readonly<{ record: (input: ProfileProjectionReconciliationDifference & Readonly<{ batchId: string; classification: 'unclassified' }>) => Promise<void> }>;

const sourceFor = (source: ProfileProjectionMigrationSource, phase: ProfileProjectionReconciliationPhase) => {
  if (phase === 'catalog') return source.listCatalogItems;
  if (phase === 'packages') return source.listPackageItems;
  if (phase === 'starred') return source.listStarredItems;
  return source.listManifests;
};

export const runProfileProjectionReconciliationToCompletion = async (input: Readonly<{
  batchId: string;
  source: ProfileProjectionMigrationSource;
  target: (phase: ProfileProjectionReconciliationPhase, sourceItems: readonly Snapshot[]) => Promise<readonly Snapshot[]>;
  checkpoint: Checkpoint;
  sink: DifferenceSink;
  batchSize: number;
  phases?: readonly ProfileProjectionReconciliationPhase[];
}>): Promise<Readonly<{ sourceCount: number; differences: number }>> => {
  const phases = input.phases ?? ['catalog', 'packages', 'starred', 'manifests'];
  let sourceCount = 0;
  let differences = 0;
  for (const phase of phases) {
    const seenCursors = new Set<string>();
    while (true) {
      const prior = await input.checkpoint.load(input.batchId, phase);
      if (prior?.completed) break;
      if (prior?.sourceCursor) {
        if (seenCursors.has(prior.sourceCursor)) throw new Error('Profile projection reconciliation source cursor repeated');
        seenCursors.add(prior.sourceCursor);
      }
      const result = await reconcileProfileProjectionPage({ ...input, phase });
      sourceCount += result.sourceCount;
      differences += result.differences;
      if (result.done) break;
    }
  }
  return { sourceCount, differences };
};

export const reconcileProfileProjectionPage = async (input: Readonly<{
  batchId: string;
  phase: ProfileProjectionReconciliationPhase;
  source: ProfileProjectionMigrationSource;
  target: (phase: ProfileProjectionReconciliationPhase, sourceItems: readonly Snapshot[]) => Promise<readonly Snapshot[]>;
  checkpoint: Checkpoint;
  sink: DifferenceSink;
  batchSize: number;
}>): Promise<Readonly<{ done: boolean; sourceCount: number; differences: number }>> => {
  if (!Number.isSafeInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > 250) throw new Error('Profile projection reconciliation batch size must be an integer between 1 and 250');
  const prior = await input.checkpoint.load(input.batchId, input.phase);
  if (prior?.completed) return { done: true, sourceCount: 0, differences: 0 };
  await input.checkpoint.start(input.batchId, input.phase);
  try {
    const page = await sourceFor(input.source, input.phase)({ cursor: prior?.sourceCursor ?? null, limit: input.batchSize }) as ProfileProjectionSourcePage<Snapshot>;
    if (!page.done && !page.cursor) throw new Error('Profile projection reconciliation source page is incomplete without a cursor');
    const target = await input.target(input.phase, page.items);
    const differences = reconcileProfileProjectionPhase({ phase: input.phase, source: page.items, target });
    for (const difference of differences) await input.sink.record({ ...difference, batchId: input.batchId, classification: 'unclassified' });
    await input.checkpoint.advance({ batchId: input.batchId, phase: input.phase, cursor: page.done ? null : page.cursor, sourceCount: page.items.length, differenceCount: differences.length, completed: page.done });
    return { done: page.done, sourceCount: page.items.length, differences: differences.length };
  } catch (error) {
    await input.checkpoint.fail(input.batchId, input.phase, 'profile_projection_reconciliation_failed');
    throw error;
  }
};