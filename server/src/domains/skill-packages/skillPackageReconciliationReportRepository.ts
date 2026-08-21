import { randomUUID } from 'node:crypto';
import type { SkillPackageDomain } from './skillPackageMigrationPort.js';
import type { SkillPackageReconciliationCheckpoint } from './skillPackageReconciliationCheckpointRepository.js';

type SqlConnection = Readonly<{
  query: (sql: string, values?: readonly unknown[]) => Promise<unknown>;
}>;

type CountRow = Readonly<{ count: number | bigint | string }>;

const rows = <T>(result: unknown): readonly T[] =>
  Array.isArray(result) && Array.isArray(result[0]) ? result[0] as T[] : [];

export type SkillPackageReconciliationSummary = Readonly<{
  batchId: string;
  domain: SkillPackageDomain;
  sourceAggregates: number;
  targetAggregates: number;
  comparedAggregates: number;
  differences: number;
}>;

export type SkillPackageReconciliationReport = SkillPackageReconciliationSummary & Readonly<{
  unclassifiedDifferences: number;
  orphanDifferences: number;
  missingAssetCount: number;
  sourceCursor: string | null;
  checkpointComplete: boolean;
  candidateReady: boolean;
}>;

const count = async (connection: SqlConnection, sql: string, values: readonly unknown[]): Promise<number> => {
  const [row] = rows<CountRow>(await connection.query(sql, values));
  return Number(row?.count ?? 0);
};

export const createSkillPackageReconciliationReportRepository = (connection: SqlConnection) =>
  Object.freeze({
    persist: async (
      summary: SkillPackageReconciliationSummary,
      checkpoint: SkillPackageReconciliationCheckpoint | null,
    ): Promise<SkillPackageReconciliationReport> => {
      const domain = `skill_package_${summary.domain}`;
      const [unclassifiedDifferences, orphanDifferences, missingAssetCount] = await Promise.all([
        count(connection,
          `SELECT COUNT(*) AS count FROM convex_exit_reconciliation_records
           WHERE domain = ? AND batchId = ? AND classification = 'unclassified' AND resolvedAt IS NULL`,
          [domain, summary.batchId]),
        count(connection,
          `SELECT COUNT(*) AS count FROM convex_exit_reconciliation_records
           WHERE domain = ? AND batchId = ? AND differenceKind = 'orphan' AND resolvedAt IS NULL`,
          [domain, summary.batchId]),
        count(connection,
          `SELECT COUNT(*) AS count
           FROM skill_package_artifact_snapshots artifact
           INNER JOIN skill_package_version_snapshots version ON version.id = artifact.versionSnapshotId
           INNER JOIN skill_package_snapshots snapshot ON snapshot.id = version.snapshotId
           WHERE snapshot.domain = ? AND artifact.copyStatus <> 'copied'`,
          [summary.domain]),
      ]);
      const checkpointComplete = checkpoint?.completed === true && !checkpoint.failed;
      const report: SkillPackageReconciliationReport = {
        ...summary,
        unclassifiedDifferences,
        orphanDifferences,
        missingAssetCount,
        sourceCursor: checkpoint?.sourceCursor ?? null,
        checkpointComplete,
        candidateReady: checkpointComplete && unclassifiedDifferences === 0 && orphanDifferences === 0 && missingAssetCount === 0,
      };
      await connection.query(
        `INSERT INTO skill_package_reconciliation_reports
           (id, batchId, domain, sourceAggregates, targetAggregates, comparedAggregates,
            differenceCount, unclassifiedDifferenceCount, orphanDifferenceCount, missingAssetCount,
            candidateReady, sourceCursor, checkpointComplete)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE sourceAggregates = VALUES(sourceAggregates),
           targetAggregates = VALUES(targetAggregates), comparedAggregates = VALUES(comparedAggregates),
           differenceCount = VALUES(differenceCount), unclassifiedDifferenceCount = VALUES(unclassifiedDifferenceCount),
           orphanDifferenceCount = VALUES(orphanDifferenceCount), missingAssetCount = VALUES(missingAssetCount),
           candidateReady = VALUES(candidateReady), sourceCursor = VALUES(sourceCursor),
           checkpointComplete = VALUES(checkpointComplete), failureCode = NULL`,
        [randomUUID(), report.batchId, report.domain, report.sourceAggregates, report.targetAggregates,
          report.comparedAggregates, report.differences, report.unclassifiedDifferences,
          report.orphanDifferences, report.missingAssetCount, report.candidateReady, report.sourceCursor,
          report.checkpointComplete],
      );
      return report;
    },
  });