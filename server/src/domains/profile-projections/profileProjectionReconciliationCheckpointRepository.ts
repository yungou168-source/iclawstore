import type { ProfileProjectionReconciliationPhase } from './profileProjectionReconciliation.js';

type SqlConnection = Readonly<{ query: (sql: string, values?: readonly unknown[]) => Promise<unknown> }>;

type Row = Readonly<{
  batchId: string;
  phase: ProfileProjectionReconciliationPhase;
  sourceCursor: string | null;
  pageCount: number | bigint | string;
  sourceCount: number | bigint | string;
  differenceCount: number | bigint | string;
  completedAt: Date | string | null;
  failedAt: Date | string | null;
}>;

const rows = <T>(result: unknown): readonly T[] => Array.isArray(result) && Array.isArray(result[0]) ? result[0] as T[] : [];
const count = (value: number | bigint | string): number => Number(value);

export type ProfileProjectionReconciliationCheckpoint = Readonly<{
  batchId: string;
  phase: ProfileProjectionReconciliationPhase;
  sourceCursor: string | null;
  pageCount: number;
  sourceCount: number;
  differenceCount: number;
  completed: boolean;
  failed: boolean;
}>;

const decode = (row: Row): ProfileProjectionReconciliationCheckpoint => ({
  batchId: row.batchId,
  phase: row.phase,
  sourceCursor: row.sourceCursor,
  pageCount: count(row.pageCount),
  sourceCount: count(row.sourceCount),
  differenceCount: count(row.differenceCount),
  completed: row.completedAt !== null,
  failed: row.failedAt !== null,
});

export const createProfileProjectionReconciliationCheckpointRepository = (connection: SqlConnection) => Object.freeze({
  load: async (batchId: string, phase: ProfileProjectionReconciliationPhase): Promise<ProfileProjectionReconciliationCheckpoint | null> => {
    const [row] = rows<Row>(await connection.query(
      `SELECT batchId,phase,sourceCursor,pageCount,sourceCount,differenceCount,completedAt,failedAt
       FROM profile_projection_reconciliation_checkpoints WHERE batchId = ? AND phase = ? LIMIT 1`,
      [batchId, phase],
    ));
    return row ? decode(row) : null;
  },
  start: async (batchId: string, phase: ProfileProjectionReconciliationPhase): Promise<void> => {
    await connection.query(
      `INSERT INTO profile_projection_reconciliation_checkpoints (batchId,phase)
       VALUES (?,?) ON DUPLICATE KEY UPDATE failedAt=NULL,failureCode=NULL`,
      [batchId, phase],
    );
  },
  advance: async (input: Readonly<{ batchId: string; phase: ProfileProjectionReconciliationPhase; cursor: string | null; sourceCount: number; differenceCount: number; completed: boolean }>): Promise<void> => {
    await connection.query(
      `UPDATE profile_projection_reconciliation_checkpoints
       SET sourceCursor=?,pageCount=pageCount+1,sourceCount=sourceCount+?,differenceCount=differenceCount+?,
           completedAt=IF(?,CURRENT_TIMESTAMP(3),NULL),failedAt=NULL,failureCode=NULL
       WHERE batchId=? AND phase=? AND completedAt IS NULL`,
      [input.cursor,input.sourceCount,input.differenceCount,input.completed,input.batchId,input.phase],
    );
  },
  fail: async (batchId: string, phase: ProfileProjectionReconciliationPhase, failureCode: string): Promise<void> => {
    await connection.query(
      `UPDATE profile_projection_reconciliation_checkpoints SET failedAt=CURRENT_TIMESTAMP(3),failureCode=?
       WHERE batchId=? AND phase=? AND completedAt IS NULL`,
      [failureCode,batchId,phase],
    );
  },
});