import type { Lease } from '../runtime/runtimeFoundation.js';
import type { SoulRuntimeJob, SoulRuntimeJobKind } from './soulRuntimeJobs.js';

export type SoulWorkerStore = Readonly<{
  checkpoint: (workerName: string, cursor: string | null, watermark: string, completed: boolean) => Promise<void>;
  renew: (workerName: string, lease: Lease, durationMs: number) => Promise<Lease | null>;
}>;

export const runSoulRuntimeJob = async (input: Readonly<{
  workerName: string;
  lease: Lease;
  leaseDurationMs: number;
  store: SoulWorkerStore;
  job: SoulRuntimeJob;
}>): Promise<boolean> => {
  const renewed = await input.store.renew(input.workerName, input.lease, input.leaseDurationMs);
  if (!renewed) return false;
  const result = await input.job.runPage();
  await input.store.checkpoint(input.workerName, result.cursor, result.watermark, result.completed);
  return true;
};

export const selectedSoulRuntimeJob = (
  kind: string | undefined,
  jobs: ReadonlyMap<SoulRuntimeJobKind, SoulRuntimeJob>,
): SoulRuntimeJob | null => kind ? jobs.get(kind as SoulRuntimeJobKind) ?? null : null;