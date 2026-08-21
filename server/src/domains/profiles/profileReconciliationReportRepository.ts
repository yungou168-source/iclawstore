import { randomUUID } from 'node:crypto';
import type { ProfileReconciliationCheckpoint } from './profileReconciliationCheckpointRepository.js';
import type { ProfileReconciliationSummary } from './profileReconciliationRunner.js';

type SqlConnection = Readonly<{
  query: (sql: string, values?: readonly unknown[]) => Promise<unknown>;
}>;

type CountRow = Readonly<{ count: number | string | bigint }>;

const rows = <T>(result: unknown): readonly T[] =>
  Array.isArray(result) && Array.isArray(result[0]) ? result[0] as T[] : [];

export type ProfileReconciliationReport = ProfileReconciliationSummary & Readonly<{
  sourceCursor: string | null;
  sourceWatermark: number | null;
  sourceRange: string | null;
  checkpointComplete: boolean;
  retainedFixtureDifferences: number;
}>;

export const createProfileReconciliationReportRepository = (connection: SqlConnection) =>
  Object.freeze({
    persist: async (
      summary: ProfileReconciliationSummary,
      checkpoint: ProfileReconciliationCheckpoint | null,
    ): Promise<ProfileReconciliationReport> => {
      const [unclassified] = rows<CountRow>(await connection.query(
        `SELECT COUNT(*) AS count
         FROM convex_exit_reconciliation_records
         WHERE domain = 'profiles' AND batchId = ?
           AND classification = 'unclassified' AND resolvedAt IS NULL`,
        [summary.batchId],
      ));
      const [retained] = rows<CountRow>(await connection.query(
        `SELECT COUNT(*) AS count
         FROM convex_exit_reconciliation_records
         WHERE domain = 'profiles' AND batchId = ?
           AND classification = 'expected_retired_fixture' AND resolvedAt IS NULL`,
        [summary.batchId],
      ));
      const unclassifiedDifferences = Number(unclassified?.count ?? 0);
      const retainedFixtureDifferences = Number(retained?.count ?? 0);
      const sourceCursor = checkpoint?.sourceCursor ?? null;
      const sourceWatermark = checkpoint?.sourceWatermark ?? null;
      const sourceRange = checkpoint?.sourceRange ?? null;
      const checkpointComplete = checkpoint?.completed === true && !checkpoint.failed;
      const report: ProfileReconciliationReport = {
        ...summary,
        unclassifiedDifferences,
        retainedFixtureDifferences,
        candidateReady: checkpointComplete && unclassifiedDifferences === 0,
        sourceCursor,
        sourceWatermark,
        sourceRange,
        checkpointComplete,
      };
      await connection.query(
        `INSERT INTO profile_reconciliation_reports
           (id, batchId, sourceProfiles, targetProfiles, comparedProfiles, differenceCount,
            unclassifiedDifferenceCount, retainedFixtureDifferenceCount, candidateReady, sourceCursor, sourceWatermark,
            sourceRange, checkpointComplete)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           sourceProfiles = VALUES(sourceProfiles), targetProfiles = VALUES(targetProfiles),
           comparedProfiles = VALUES(comparedProfiles), differenceCount = VALUES(differenceCount),
           unclassifiedDifferenceCount = VALUES(unclassifiedDifferenceCount),
           retainedFixtureDifferenceCount = VALUES(retainedFixtureDifferenceCount),
           candidateReady = VALUES(candidateReady), sourceCursor = VALUES(sourceCursor),
           sourceWatermark = VALUES(sourceWatermark), sourceRange = VALUES(sourceRange),
           checkpointComplete = VALUES(checkpointComplete), failureCode = NULL`,
        [
          randomUUID(), report.batchId, report.sourceProfiles, report.targetProfiles,
          report.comparedProfiles, report.differences, report.unclassifiedDifferences,
          report.retainedFixtureDifferences, report.candidateReady, report.sourceCursor, report.sourceWatermark,
          report.sourceRange, report.checkpointComplete,
        ],
      );
      return report;
    },
  });