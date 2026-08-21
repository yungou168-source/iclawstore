import type { SkillPackageDomain } from './skillPackageMigrationPort.js';

type SqlConnection = Readonly<{
  query: (sql: string, values?: readonly unknown[]) => Promise<unknown>;
}>;

export type SkillPackageReconciliationCheckpoint = Readonly<{
  batchId: string;
  domain: SkillPackageDomain;
  sourceCursor: string | null;
  pageCount: number;
  sourceCount: number;
  comparedCount: number;
  differenceCount: number;
  sourceExhausted: boolean;
  completed: boolean;
  failed: boolean;
}>;

type CheckpointRow = Readonly<{
  batchId: string;
  domain: SkillPackageDomain;
  sourceCursor: string | null;
  pageCount: number | bigint | string;
  sourceCount: number | bigint | string;
  comparedCount: number | bigint | string;
  differenceCount: number | bigint | string;
  sourceExhaustedAt: Date | string | null;
  completedAt: Date | string | null;
  failedAt: Date | string | null;
}>;

const rows = <T>(result: unknown): readonly T[] =>
  Array.isArray(result) && Array.isArray(result[0]) ? result[0] as T[] : [];

const toCheckpoint = (row: CheckpointRow): SkillPackageReconciliationCheckpoint => ({
  batchId: row.batchId,
  domain: row.domain,
  sourceCursor: row.sourceCursor,
  pageCount: Number(row.pageCount),
  sourceCount: Number(row.sourceCount),
  comparedCount: Number(row.comparedCount),
  differenceCount: Number(row.differenceCount),
  sourceExhausted: row.sourceExhaustedAt !== null,
  completed: row.completedAt !== null,
  failed: row.failedAt !== null,
});

export const createSkillPackageReconciliationCheckpointRepository = (connection: SqlConnection) =>
  Object.freeze({
    load: async (batchId: string): Promise<SkillPackageReconciliationCheckpoint | null> => {
      const [row] = rows<CheckpointRow>(await connection.query(
        `SELECT batchId, domain, sourceCursor, pageCount, sourceCount, comparedCount,
                differenceCount, sourceExhaustedAt, completedAt, failedAt
         FROM skill_package_reconciliation_checkpoints WHERE batchId = ? LIMIT 1`,
        [batchId],
      ));
      return row ? toCheckpoint(row) : null;
    },
    start: async (input: Readonly<{ batchId: string; domain: SkillPackageDomain }>): Promise<void> => {
      await connection.query(
        `INSERT INTO skill_package_reconciliation_checkpoints (batchId, domain)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE batchId = batchId`,
        [input.batchId, input.domain],
      );
    },
    advance: async (input: Readonly<{
      batchId: string;
      sourceCursor: string | null;
      sourceCount: number;
      comparedCount: number;
      differenceCount: number;
      sourceExhausted: boolean;
    }>): Promise<void> => {
      await connection.query(
        `UPDATE skill_package_reconciliation_checkpoints
         SET sourceCursor = ?, pageCount = pageCount + 1, sourceCount = sourceCount + ?,
             comparedCount = comparedCount + ?, differenceCount = differenceCount + ?,
             sourceExhaustedAt = IF(?, CURRENT_TIMESTAMP(3), sourceExhaustedAt),
             failedAt = NULL, failureCode = NULL
         WHERE batchId = ? AND completedAt IS NULL`,
        [input.sourceCursor, input.sourceCount, input.comparedCount, input.differenceCount,
          input.sourceExhausted, input.batchId],
      );
    },
    complete: async (batchId: string, additionalDifferences = 0): Promise<void> => {
      await connection.query(
        `UPDATE skill_package_reconciliation_checkpoints
         SET differenceCount = differenceCount + ?, completedAt = CURRENT_TIMESTAMP(3),
             failedAt = NULL, failureCode = NULL
         WHERE batchId = ? AND completedAt IS NULL`,
        [additionalDifferences, batchId],
      );
    },
    fail: async (batchId: string, failureCode: string): Promise<void> => {
      await connection.query(
        `UPDATE skill_package_reconciliation_checkpoints
         SET failedAt = CURRENT_TIMESTAMP(3), failureCode = ?
         WHERE batchId = ? AND completedAt IS NULL`,
        [failureCode.slice(0, 128), batchId],
      );
    },
  });