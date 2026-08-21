import { describe, expect, it, mock } from 'bun:test';
import { createProfileProjectionReconciliationReportRepository } from '../src/domains/profile-projections/profileProjectionReconciliationReportRepository.js';

describe('profile projection reconciliation report repository', () => {
  it('only marks candidate ready after every phase completes with no unclassified differences', async () => {
    const query = mock(async (sql: string) => {
      if (sql.includes('FROM profile_projection_reconciliation_checkpoints')) {
        return [[
          { phase: 'catalog', sourceCount: 2, differenceCount: 0, completedAt: new Date(), failedAt: null },
          { phase: 'packages', sourceCount: 3, differenceCount: 0, completedAt: new Date(), failedAt: null },
          { phase: 'starred', sourceCount: 5, differenceCount: 0, completedAt: new Date(), failedAt: null },
          { phase: 'manifests', sourceCount: 7, differenceCount: 0, completedAt: new Date(), failedAt: null },
        ], []];
      }
      if (sql.includes('COUNT(*)')) return [[{ count: 0 }], []];
      return [[], []];
    });
    const report = await createProfileProjectionReconciliationReportRepository({ query }).persist('batch-1');
    expect(report).toEqual({
      batchId: 'batch-1', sourceCount: 17, differenceCount: 0,
      unclassifiedDifferenceCount: 0, checkpointComplete: true, candidateReady: true,
    });
  });

  it('fails closed when a phase is absent or unresolved differences remain', async () => {
    const query = mock(async (sql: string) => {
      if (sql.includes('FROM profile_projection_reconciliation_checkpoints')) {
        return [[{ phase: 'catalog', sourceCount: 1, differenceCount: 1, completedAt: new Date(), failedAt: null }], []];
      }
      if (sql.includes('COUNT(*)')) return [[{ count: 1 }], []];
      return [[], []];
    });
    const report = await createProfileProjectionReconciliationReportRepository({ query }).persist('batch-1');
    expect(report.checkpointComplete).toBe(false);
    expect(report.candidateReady).toBe(false);
  });
});