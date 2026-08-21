import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { SoulFactsRepository } from './mysqlSoulFactsRepository.js';
import type { SoulMigrationSource } from './soulMigrationRuntime.js';
import { reconcileSoulSnapshots } from './soulReconciliation.js';
import { assessSoulReconciliationGate } from './soulReconciliationGate.js';
import type { SoulMigrationJobKind } from './mysqlSoulMigrationControlPlane.js';

type CountRow = RowDataPacket & { count: number };

export const collectSoulSource = async (source: SoulMigrationSource, limit = 100): Promise<{ snapshots: readonly import('./soulMigrationDto.js').SoulSnapshot[]; watermark: string }> => {
  const snapshots = [] as import('./soulMigrationDto.js').SoulSnapshot[];
  let cursor: string | null = null;
  let watermark = '';
  for (;;) {
    const page = await source.page({ cursor, limit });
    watermark = page.watermark;
    snapshots.push(...page.snapshots);
    if (page.exhausted) return { snapshots, watermark };
    if (!page.cursor || page.cursor === cursor) throw new Error('Soul reconciliation source cursor did not advance');
    cursor = page.cursor;
  }
};

export const createMysqlSoulReconciliationRunner = (input: Readonly<{
  pool: Pool;
  source: SoulMigrationSource;
  target: Pick<SoulFactsRepository, 'listAll'>;
  persistReport: (report: Readonly<{ batchId: string; jobKind: SoulMigrationJobKind; watermark: string | null; sourceCount: number; targetCount: number; differenceCount: number; missingAssetCount: number; candidateReady: boolean }>) => Promise<void>;
  batchId: string;
  limit?: number;
}>) => async () => {
  const source = await collectSoulSource(input.source, input.limit ?? 100);
  const target = await input.target.listAll();
  const differences = reconcileSoulSnapshots({ source: source.snapshots, target });
  const [pendingRows] = await input.pool.query<CountRow[]>("SELECT COUNT(*) AS count FROM soul_version_file_snapshots WHERE assetReferenceState <> 'copied'");
  const missingAssets = Number(pendingRows[0]?.count ?? 0);
  const gate = assessSoulReconciliationGate({ differences, missingAssets, watermark: source.watermark, completed: true });
  const report = { batchId: input.batchId, jobKind: 'soul-reconcile' as const, watermark: source.watermark, sourceCount: source.snapshots.length, targetCount: target.length, differenceCount: differences.length, missingAssetCount: missingAssets, candidateReady: gate.ready };
  await input.persistReport(report);
  return { ...report, differences, gate };
};