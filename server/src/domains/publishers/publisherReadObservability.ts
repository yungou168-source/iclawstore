import type { Pool, RowDataPacket } from "mysql2/promise";

export type PublisherReadMetric = "mysqlHit" | "fallback" | "diff" | "adapterError";
export type PublisherReadMetrics = Readonly<Record<PublisherReadMetric, number>>;

export type PublisherReadObserver = Readonly<{
  increment: (metric: PublisherReadMetric, amount?: number) => void;
  snapshot: () => PublisherReadMetrics;
}>;

export const createPublisherReadObserver = (): PublisherReadObserver => {
  const counts: Record<PublisherReadMetric, number> = {
    mysqlHit: 0,
    fallback: 0,
    diff: 0,
    adapterError: 0,
  };
  return Object.freeze({
    increment: (metric, amount = 1) => {
      counts[metric] += amount;
    },
    snapshot: () => Object.freeze({ ...counts }),
  });
};

type SyncRow = RowDataPacket & {
  watermark: number | string | null;
  cursorAgeMs: number | string | null;
  retryCount: number | string;
  lastFailureCode: string | null;
};

type CountRow = RowDataPacket & { count: number | string };

export type PublisherMigrationMetrics = Readonly<{
  watermark: number | null;
  watermarkLagMs: number | null;
  cursorAgeMs: number | null;
  retryCount: number;
  lastFailureCode: string | null;
  pendingAssets: number;
  failedAssets: number;
  unclassifiedDifferences: number;
  candidateReady: boolean;
}>;

export const createPublisherMigrationMetricsProvider = (pool: Pool, now: () => number = Date.now) =>
  Object.freeze({
    snapshot: async (): Promise<PublisherMigrationMetrics> => {
      const [[syncRows], [pendingAssetRows], [failedAssetRows], [differenceRows]] =
        await Promise.all([
          pool.query<SyncRow[]>(
            `SELECT watermark, cursorAgeMs, retryCount, lastFailureCode
           FROM publisher_sync_checkpoints
           ORDER BY updatedAt DESC LIMIT 1`,
          ),
          pool.query<CountRow[]>(
            `SELECT COUNT(*) AS count
           FROM publisher_avatar_snapshots
           WHERE status IN ('pending', 'processing', 'external')`,
          ),
          pool.query<CountRow[]>(
            `SELECT COUNT(*) AS count
           FROM publisher_avatar_snapshots
           WHERE status = 'failed'`,
          ),
          pool.query<CountRow[]>(
            `SELECT COUNT(*) AS count
           FROM convex_exit_reconciliation_records
           WHERE domain = 'publishers' AND classification = 'unclassified' AND resolvedAt IS NULL`,
          ),
        ]);
      const sync = syncRows[0];
      const watermark =
        sync?.watermark === null || sync?.watermark === undefined ? null : Number(sync.watermark);
      const pendingAssets = Number(pendingAssetRows[0]?.count ?? 0);
      const failedAssets = Number(failedAssetRows[0]?.count ?? 0);
      const unclassifiedDifferences = Number(differenceRows[0]?.count ?? 0);
      return {
        watermark,
        watermarkLagMs: watermark === null ? null : Math.max(0, now() - watermark),
        cursorAgeMs:
          sync?.cursorAgeMs === null || sync?.cursorAgeMs === undefined
            ? null
            : Number(sync.cursorAgeMs),
        retryCount: Number(sync?.retryCount ?? 0),
        lastFailureCode: sync?.lastFailureCode ?? null,
        pendingAssets,
        failedAssets,
        unclassifiedDifferences,
        candidateReady: pendingAssets === 0 && failedAssets === 0 && unclassifiedDifferences === 0,
      };
    },
  });
