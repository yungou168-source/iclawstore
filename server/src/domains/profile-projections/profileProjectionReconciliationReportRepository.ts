import { randomUUID } from 'node:crypto';
import type { ProfileProjectionReconciliationPhase } from './profileProjectionReconciliation.js';

type SqlConnection = Readonly<{
  query: (sql: string, values?: readonly unknown[]) => Promise<unknown>;
}>;

type CountRow = Readonly<{ count: number | string | bigint }>;
type CheckpointRow = Readonly<{
  phase: ProfileProjectionReconciliationPhase;
  sourceCount: number | string | bigint;
  differenceCount: number | string | bigint;
  completedAt: Date | string | null;
  failedAt: Date | string | null;
}>;

const phases: readonly ProfileProjectionReconciliationPhase[] = ['catalog', 'packages', 'starred', 'manifests'];

const rows = <T>(result: unknown): readonly T[] =>
  Array.isArray(result) && Array.isArray(result[0]) ? result[0] as T[] : [];

const number = (value: number | string | bigint): number => Number(value);

export type ProfileProjectionReconciliationReport = Readonly<{
  batchId: string;
  sourceCount: number;
  differenceCount: number;
  unclassifiedDifferenceCount: number;
  candidateReady: boolean;
  checkpointComplete: boolean;
}>;

export const createProfileProjectionReconciliationReportRepository = (connection: SqlConnection) => Object.freeze({
  persist: async (batchId: string): Promise<ProfileProjectionReconciliationReport> => {
    const checkpoints = rows<CheckpointRow>(await connection.query(
      `SELECT phase,sourceCount,differenceCount,completedAt,failedAt
       FROM profile_projection_reconciliation_checkpoints WHERE batchId = ?`,
      [batchId],
    ));
    const checkpointByPhase = new Map(checkpoints.map((checkpoint) => [checkpoint.phase, checkpoint]));
    const checkpointComplete = phases.every((phase) => {
      const checkpoint = checkpointByPhase.get(phase);
      return checkpoint?.completedAt !== null && checkpoint?.failedAt === null;
    });
    const [unclassified] = rows<CountRow>(await connection.query(
      `SELECT COUNT(*) AS count FROM convex_exit_reconciliation_records
       WHERE domain = 'profile_projections' AND batchId = ?
         AND classification = 'unclassified' AND resolvedAt IS NULL`,
      [batchId],
    ));
    const sourceCount = checkpoints.reduce((total, checkpoint) => total + number(checkpoint.sourceCount), 0);
    const differenceCount = checkpoints.reduce((total, checkpoint) => total + number(checkpoint.differenceCount), 0);
    const unclassifiedDifferenceCount = number(unclassified?.count ?? 0);
    const report: ProfileProjectionReconciliationReport = {
      batchId,
      sourceCount,
      differenceCount,
      unclassifiedDifferenceCount,
      checkpointComplete,
      candidateReady: checkpointComplete && unclassifiedDifferenceCount === 0,
    };
    await connection.query(
      `INSERT INTO profile_projection_reconciliation_reports
       (id,batchId,sourceCount,differenceCount,unclassifiedDifferenceCount,candidateReady)
       VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE sourceCount=VALUES(sourceCount),differenceCount=VALUES(differenceCount),
         unclassifiedDifferenceCount=VALUES(unclassifiedDifferenceCount),candidateReady=VALUES(candidateReady)`,
      [randomUUID(), report.batchId, report.sourceCount, report.differenceCount,
        report.unclassifiedDifferenceCount, report.candidateReady],
    );
    return report;
  },
});