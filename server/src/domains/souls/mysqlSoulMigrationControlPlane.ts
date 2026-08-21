import { randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { SoulMigrationCheckpoint } from './soulMigrationRuntime.js';

type Row = RowDataPacket & Record<string, unknown>;

const rows = <T>(result: unknown): readonly T[] =>
  Array.isArray(result) && Array.isArray(result[0]) ? result[0] as T[] : [];

export type SoulMigrationJobKind = 'soul-full-import' | 'soul-incremental-sync' | 'soul-asset-copy' | 'soul-reconcile';

export const createMysqlSoulMigrationControlPlane = (pool: Pool) => Object.freeze({
  loadCheckpoint: async (batchId: string, jobKind: SoulMigrationJobKind): Promise<SoulMigrationCheckpoint | null> => {
    const [row] = rows<Readonly<{ cursorValue: string | null; watermark: string | null; completedAt: Date | null }>>(
      await pool.query('SELECT cursorValue, watermark, completedAt FROM soul_migration_checkpoints WHERE batchId = ? AND jobKind = ? LIMIT 1', [batchId, jobKind]),
    );
    return row ? { cursor: row.cursorValue, watermark: row.watermark, completed: row.completedAt !== null } : null;
  },
  saveCheckpoint: async (input: Readonly<{ batchId: string; jobKind: SoulMigrationJobKind; checkpoint: SoulMigrationCheckpoint; imported: number }>): Promise<void> => {
    await pool.query(
      `INSERT INTO soul_migration_checkpoints (batchId, jobKind, cursorValue, watermark, completedAt, pageCount, importedCount)
       VALUES (?, ?, ?, ?, IF(?, CURRENT_TIMESTAMP(3), NULL), 1, ?)
       ON DUPLICATE KEY UPDATE cursorValue = VALUES(cursorValue), watermark = VALUES(watermark),
         completedAt = IF(VALUES(completedAt) IS NULL, completedAt, VALUES(completedAt)),
         failedAt = NULL, failureCode = NULL, pageCount = pageCount + 1, importedCount = importedCount + VALUES(importedCount)`,
      [input.batchId, input.jobKind, input.checkpoint.cursor, input.checkpoint.watermark, input.checkpoint.completed, input.imported],
    );
  },
  failCheckpoint: async (batchId: string, jobKind: SoulMigrationJobKind, error: unknown): Promise<void> => {
    const failureCode = error instanceof Error ? error.message.slice(0, 128) : 'unknown_failure';
    await pool.query(
      `UPDATE soul_migration_checkpoints SET failedAt = CURRENT_TIMESTAMP(3), failureCode = ?
       WHERE batchId = ? AND jobKind = ? AND completedAt IS NULL`, [failureCode, batchId, jobKind],
    );
  },
  persistReport: async (input: Readonly<{ batchId: string; jobKind: SoulMigrationJobKind; watermark: string | null; sourceCount: number; targetCount: number; differenceCount: number; missingAssetCount: number; candidateReady: boolean }>): Promise<void> => {
    await pool.query(
      `INSERT INTO soul_migration_reports (id, batchId, jobKind, watermark, sourceCount, targetCount, differenceCount, missingAssetCount, candidateReady)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE watermark = VALUES(watermark), sourceCount = VALUES(sourceCount), targetCount = VALUES(targetCount),
         differenceCount = VALUES(differenceCount), missingAssetCount = VALUES(missingAssetCount), candidateReady = VALUES(candidateReady)`,
      [randomUUID(), input.batchId, input.jobKind, input.watermark, input.sourceCount, input.targetCount, input.differenceCount, input.missingAssetCount, input.candidateReady],
    );
  },
});