import type { Pool, RowDataPacket } from 'mysql2/promise';

export type ProfileReadMetric = "mysqlHit" | "fallback" | "diff" | "adapterError";

export type ProfileReadMetrics = Readonly<Record<ProfileReadMetric, number>>;

export type ProfileReadObserver = Readonly<{
  increment: (metric: ProfileReadMetric, amount?: number) => void;
  snapshot: () => ProfileReadMetrics;
}>;

export const createProfileReadObserver = (): ProfileReadObserver => {
  const counts: Record<ProfileReadMetric, number> = {
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

type AssetCountRow = RowDataPacket & { pendingAssets: number | string; failedAssets: number | string };
type DifferenceCountRow = RowDataPacket & { unclassifiedDifferences: number | string };

export type ProfileMigrationMetrics = Readonly<{
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

export const createProfileMigrationMetricsProvider = (
  pool: Pool,
  now: () => number = Date.now,
) =>
  Object.freeze({
    snapshot: async (): Promise<ProfileMigrationMetrics> => {
      const [[syncRows], [assetRows], [differenceRows]] = await Promise.all([
        pool.query<SyncRow[]>(
          `SELECT watermark, cursorAgeMs, retryCount, lastFailureCode
           FROM profile_sync_checkpoints
           ORDER BY updatedAt DESC LIMIT 1`,
        ),
        pool.query<AssetCountRow[]>(
          `SELECT
             SUM(status = 'pending') AS pendingAssets,
             SUM(status = 'failed') AS failedAssets
           FROM profile_asset_snapshots`,
        ),
        pool.query<DifferenceCountRow[]>(
          `SELECT COUNT(*) AS unclassifiedDifferences
           FROM convex_exit_reconciliation_records
           WHERE domain = 'profiles' AND classification = 'unclassified' AND resolvedAt IS NULL`,
        ),
      ]);
      const sync = syncRows[0];
      const watermark = sync?.watermark === null || sync?.watermark === undefined
        ? null
        : Number(sync.watermark);
      const pendingAssets = Number(assetRows[0]?.pendingAssets ?? 0);
      const failedAssets = Number(assetRows[0]?.failedAssets ?? 0);
      const unclassifiedDifferences = Number(differenceRows[0]?.unclassifiedDifferences ?? 0);
      return {
        watermark,
        watermarkLagMs: watermark === null ? null : Math.max(0, now() - watermark),
        cursorAgeMs: sync?.cursorAgeMs === null || sync?.cursorAgeMs === undefined
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
