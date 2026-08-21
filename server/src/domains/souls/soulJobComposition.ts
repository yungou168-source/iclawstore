import type { SoulFactsRepository } from './mysqlSoulFactsRepository.js';
import type { SoulMigrationJobKind } from './mysqlSoulMigrationControlPlane.js';
import type { SoulMigrationSource } from './soulMigrationRuntime.js';
import { importSoulMigrationPage } from './soulMigrationRuntime.js';
import type { SoulRuntimeJob, SoulRuntimeJobKind } from './soulRuntimeJobs.js';

export type SoulAssetJob = Readonly<{ copyPending: (limit: number) => Promise<{ copied: number; failed: number }> }>;
export type SoulReconcileJob = Readonly<{ run: () => Promise<{ watermark: string; candidateReady: boolean }> }>;

type ControlPlane = Readonly<{
  loadCheckpoint: (batchId: string, kind: SoulMigrationJobKind) => Promise<Awaited<ReturnType<typeof importSoulMigrationPage>>['checkpoint'] | null>;
  saveCheckpoint: (input: Readonly<{ batchId: string; jobKind: SoulMigrationJobKind; checkpoint: Awaited<ReturnType<typeof importSoulMigrationPage>>['checkpoint']; imported: number }>) => Promise<void>;
  failCheckpoint: (batchId: string, kind: SoulMigrationJobKind, error: unknown) => Promise<void>;
}>;

const importJob = (input: Readonly<{ kind: Extract<SoulRuntimeJobKind, 'soul-full-import' | 'soul-incremental-sync'>; batchId: string; limit: number; source: SoulMigrationSource; repository: Pick<SoulFactsRepository, 'upsert'>; controlPlane: ControlPlane }>): SoulRuntimeJob => ({
  kind: input.kind,
  runPage: async () => {
    const checkpoint = await input.controlPlane.loadCheckpoint(input.batchId, input.kind);
    try {
      const result = await importSoulMigrationPage({
        batchId: input.batchId, checkpoint, limit: input.limit, source: input.source,
        target: { importPage: async ({ batchId, snapshots, checkpoint: next }) => {
          for (const snapshot of snapshots) await input.repository.upsert(batchId, snapshot);
          await input.controlPlane.saveCheckpoint({ batchId, jobKind: input.kind, checkpoint: next, imported: snapshots.length });
        } },
      });
      return { completed: result.completed, cursor: result.checkpoint.cursor, watermark: result.checkpoint.watermark ?? 'unknown' };
    } catch (error) { await input.controlPlane.failCheckpoint(input.batchId, input.kind, error); throw error; }
  },
});

export const createSoulJobComposition = (input: Readonly<{
  batchId: string;
  limit?: number;
  source: SoulMigrationSource;
  repository: Pick<SoulFactsRepository, 'upsert'>;
  controlPlane: ControlPlane;
  assetJob?: SoulAssetJob;
  reconcileJob?: SoulReconcileJob;
}>): readonly SoulRuntimeJob[] => {
  const limit = input.limit ?? 100;
  const jobs: SoulRuntimeJob[] = [
    importJob({ ...input, kind: 'soul-full-import', limit }),
    importJob({ ...input, kind: 'soul-incremental-sync', limit }),
  ];
  if (input.assetJob) jobs.push({ kind: 'soul-asset-copy', runPage: async () => { const result = await input.assetJob!.copyPending(limit); return { completed: result.failed === 0, cursor: null, watermark: 'asset-copy' }; } });
  if (input.reconcileJob) jobs.push({ kind: 'soul-reconcile', runPage: async () => { const result = await input.reconcileJob!.run(); return { completed: result.candidateReady, cursor: null, watermark: result.watermark }; } });
  return jobs;
};