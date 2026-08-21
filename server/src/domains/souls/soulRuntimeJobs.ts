export type SoulRuntimeJobKind = 'soul-full-import' | 'soul-incremental-sync' | 'soul-asset-copy' | 'soul-reconcile';

export type SoulRuntimeJob = Readonly<{
  kind: SoulRuntimeJobKind;
  runPage: () => Promise<Readonly<{ completed: boolean; cursor: string | null; watermark: string }>>;
}>;

export type SoulRuntimeJobRegistry = Readonly<{
  run: (kind: SoulRuntimeJobKind) => Promise<Readonly<{ completed: boolean; cursor: string | null; watermark: string }>>;
}>;

export const createSoulRuntimeJobRegistry = (jobs: readonly SoulRuntimeJob[]): SoulRuntimeJobRegistry => {
  const byKind = new Map(jobs.map((job) => [job.kind, job]));
  return Object.freeze({
    run: async (kind) => {
      const job = byKind.get(kind);
      if (!job) throw new Error(`Soul runtime job is not registered: ${kind}`);
      return job.runPage();
    },
  });
};