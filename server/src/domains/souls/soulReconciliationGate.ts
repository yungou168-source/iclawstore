import type { SoulReconciliationDifference } from './soulReconciliation.js';

export type SoulReconciliationGate = Readonly<{
  ready: boolean;
  blockingDifferences: readonly SoulReconciliationDifference[];
  missingAssets: number;
  watermark: string;
  reason: 'ready' | 'incomplete' | 'watermark_mismatch' | 'blocking_differences' | 'missing_assets';
}>;

export const assessSoulReconciliationGate = (input: Readonly<{
  differences: readonly SoulReconciliationDifference[];
  missingAssets: number;
  watermark: string;
  targetWatermark?: string;
  completed: boolean;
}>): SoulReconciliationGate => {
  const blockingDifferences = input.differences.filter((difference) =>
    difference.differenceKind === 'missing' || difference.differenceKind === 'orphan' || difference.differenceKind === 'value_mismatch',
  );
  const watermarkMismatch = input.targetWatermark !== undefined && input.targetWatermark !== input.watermark;
  const reason = !input.completed ? 'incomplete' : watermarkMismatch ? 'watermark_mismatch' : blockingDifferences.length > 0 ? 'blocking_differences' : input.missingAssets > 0 ? 'missing_assets' : 'ready';
  return { ready: reason === 'ready', blockingDifferences, missingAssets: input.missingAssets, watermark: input.watermark, reason };
};

export type SoulReconciliationReport = Readonly<{
  batchId: string;
  watermark: string;
  sourceCount: number;
  targetCount: number;
  differenceCount: number;
  missingAssetCount: number;
  candidateReady: boolean;
  generatedAt: string;
}>;

export const createSoulReconciliationRunner = (input: Readonly<{
  persist: (report: SoulReconciliationReport) => Promise<void>;
  now?: () => Date;
}>) => async (report: Omit<SoulReconciliationReport, 'generatedAt'>): Promise<SoulReconciliationReport> => {
  const complete = { ...report, generatedAt: (input.now ?? (() => new Date()))().toISOString() };
  await input.persist(complete);
  return complete;
};