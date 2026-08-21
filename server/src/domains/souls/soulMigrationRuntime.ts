import type { SoulSnapshot } from './soulMigrationDto.js';

export type SoulMigrationSource = Readonly<{
  page: (input: Readonly<{ cursor: string | null; limit: number }>) => Promise<Readonly<{ watermark: string; cursor: string | null; exhausted: boolean; snapshots: readonly SoulSnapshot[] }>>;
}>;

export type SoulAssetCopyConsumer = Readonly<{
  copyPending: (limit: number) => Promise<Readonly<{ copied: number; failed: number }>>;
}>;

export type SoulMigrationCheckpoint = Readonly<{
  cursor: string | null;
  watermark: string | null;
  completed: boolean;
}>;

export type SoulMigrationPageTarget = Readonly<{
  importPage: (input: Readonly<{
    batchId: string;
    snapshots: readonly SoulSnapshot[];
    checkpoint: SoulMigrationCheckpoint;
  }>) => Promise<void>;
}>;

export const importSoulMigrationPage = async (input: Readonly<{
  batchId: string;
  checkpoint: SoulMigrationCheckpoint | null;
  limit: number;
  source: SoulMigrationSource;
  target: SoulMigrationPageTarget;
}>) => {
  if (input.checkpoint?.completed) return { completed: true, imported: 0, checkpoint: input.checkpoint };
  const sourcePage = await input.source.page({ cursor: input.checkpoint?.cursor ?? null, limit: input.limit });
  if (input.checkpoint?.watermark !== null && input.checkpoint?.watermark !== undefined && input.checkpoint.watermark !== sourcePage.watermark) {
    throw new Error('Soul migration source watermark changed during batch');
  }
  if (!sourcePage.exhausted && sourcePage.cursor === (input.checkpoint?.cursor ?? null)) {
    throw new Error('Soul migration source returned a non-advancing cursor');
  }
  const checkpoint: SoulMigrationCheckpoint = {
    cursor: sourcePage.exhausted ? null : sourcePage.cursor,
    watermark: sourcePage.watermark,
    completed: sourcePage.exhausted,
  };
  await input.target.importPage({ batchId: input.batchId, snapshots: sourcePage.snapshots, checkpoint });
  return { completed: checkpoint.completed, imported: sourcePage.snapshots.length, checkpoint };
};

export const createSoulMigrationRunner = (input: Readonly<{ source: SoulMigrationSource; repository: { upsert: (batchId: string, snapshot: SoulSnapshot) => Promise<string> } }>) => async (batchId: string, limit = 100) => {
  let cursor: string | null = null;
  let count = 0;
  for (;;) {
    const page = await input.source.page({ cursor, limit });
    for (const snapshot of page.snapshots) { await input.repository.upsert(batchId, snapshot); count += 1; }
    if (page.exhausted) return { count, watermark: page.watermark };
    if (page.cursor === cursor) throw new Error('Soul migration source returned a non-advancing cursor');
    cursor = page.cursor;
  }
};