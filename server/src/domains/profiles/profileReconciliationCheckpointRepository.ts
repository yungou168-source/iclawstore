type SqlConnection = Readonly<{
  query: (sql: string, values?: readonly unknown[]) => Promise<unknown>;
}>;

export type ProfileReconciliationCheckpoint = Readonly<{
  batchId: string;
  sourceWatermark: number;
  sourceRange: string;
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
  sourceWatermark: number | bigint | string;
  sourceRange: string;
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

const number = (value: number | bigint | string): number => Number(value);

const toCheckpoint = (row: CheckpointRow): ProfileReconciliationCheckpoint => ({
  batchId: row.batchId,
  sourceWatermark: number(row.sourceWatermark),
  sourceRange: row.sourceRange,
  sourceCursor: row.sourceCursor,
  pageCount: number(row.pageCount),
  sourceCount: number(row.sourceCount),
  comparedCount: number(row.comparedCount),
  differenceCount: number(row.differenceCount),
  sourceExhausted: row.sourceExhaustedAt !== null,
  completed: row.completedAt !== null,
  failed: row.failedAt !== null,
});

export const createProfileReconciliationCheckpointRepository = (connection: SqlConnection) =>
  Object.freeze({
    load: async (batchId: string): Promise<ProfileReconciliationCheckpoint | null> => {
      const [row] = rows<CheckpointRow>(await connection.query(
        `SELECT batchId, sourceWatermark, sourceRange, sourceCursor, pageCount, sourceCount,
                comparedCount, differenceCount, sourceExhaustedAt, completedAt, failedAt
         FROM profile_reconciliation_checkpoints WHERE batchId = ? LIMIT 1`,
        [batchId],
      ));
      return row ? toCheckpoint(row) : null;
    },
    start: async (input: Readonly<{ batchId: string; sourceWatermark: number; sourceRange: string }>): Promise<void> => {
      await connection.query(
        `INSERT INTO profile_reconciliation_checkpoints (batchId, sourceWatermark, sourceRange)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE batchId = batchId`,
        [input.batchId, input.sourceWatermark, input.sourceRange],
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
        `UPDATE profile_reconciliation_checkpoints
         SET sourceCursor = ?, pageCount = pageCount + 1, sourceCount = sourceCount + ?,
             comparedCount = comparedCount + ?, differenceCount = differenceCount + ?,
             sourceExhaustedAt = IF(?, CURRENT_TIMESTAMP(3), sourceExhaustedAt),
             failedAt = NULL, failureCode = NULL
         WHERE batchId = ? AND completedAt IS NULL`,
        [input.sourceCursor, input.sourceCount, input.comparedCount, input.differenceCount, input.sourceExhausted, input.batchId],
      );
    },
    recordSourceIds: async (batchId: string, legacyConvexIds: readonly string[]): Promise<void> => {
      if (legacyConvexIds.length === 0) return;
      const placeholders = legacyConvexIds.map(() => '(?, ?)').join(', ');
      await connection.query(
        `INSERT INTO profile_reconciliation_source_ids (batchId, legacyConvexId)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE observedAt = CURRENT_TIMESTAMP(3)`,
        legacyConvexIds.flatMap((legacyConvexId) => [batchId, legacyConvexId]),
      );
    },
    complete: async (batchId: string, additionalDifferences: number): Promise<void> => {
      await connection.query(
        `UPDATE profile_reconciliation_checkpoints
         SET differenceCount = differenceCount + ?, completedAt = CURRENT_TIMESTAMP(3),
             failedAt = NULL, failureCode = NULL
         WHERE batchId = ? AND completedAt IS NULL`,
        [additionalDifferences, batchId],
      );
    },
    fail: async (batchId: string, failureCode: string): Promise<void> => {
      await connection.query(
        `UPDATE profile_reconciliation_checkpoints
         SET failedAt = CURRENT_TIMESTAMP(3), failureCode = ?
         WHERE batchId = ? AND completedAt IS NULL`,
        [failureCode, batchId],
      );
    },
  });