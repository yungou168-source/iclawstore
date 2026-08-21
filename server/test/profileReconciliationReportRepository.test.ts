import { describe, expect, it, mock } from 'bun:test';
import { createProfileReconciliationReportRepository } from '../src/domains/profiles/profileReconciliationReportRepository.js';

describe('Profile reconciliation report repository', () => {
  it('persists a fail-closed report when the batch has unclassified records', async () => {
    const query = mock(async (sql: string) =>
      sql.includes('SELECT COUNT(*)') ? [[{ count: 2 }], []] : [{ affectedRows: 1 }, []],
    );
    const repository = createProfileReconciliationReportRepository({ query });

    await expect(repository.persist({
      batchId: 'batch-1', sourceProfiles: 4, targetProfiles: 4, comparedProfiles: 4,
      differences: 2, unclassifiedDifferences: 2, candidateReady: false,
    }, null)).resolves.toEqual({
      batchId: 'batch-1', sourceProfiles: 4, targetProfiles: 4, comparedProfiles: 4,
      differences: 2, unclassifiedDifferences: 2, retainedFixtureDifferences: 2, candidateReady: false,
      sourceCursor: null, sourceWatermark: null, sourceRange: null, checkpointComplete: false,
    });
    expect(query.mock.calls.some(([sql, values]) =>
      String(sql).includes('INSERT INTO profile_reconciliation_reports') && Array.isArray(values) && values[8] === false,
    )).toBe(true);
  });

  it('allows readiness only for a zero-difference, zero-unclassified report', async () => {
    const query = mock(async (sql: string) =>
      sql.includes('SELECT COUNT(*)') ? [[{ count: 0 }], []] : [{ affectedRows: 1 }, []],
    );
    const repository = createProfileReconciliationReportRepository({ query });

    await expect(repository.persist({
      batchId: 'batch-2', sourceProfiles: 4, targetProfiles: 4, comparedProfiles: 4,
      differences: 0, unclassifiedDifferences: 0, candidateReady: true,
    }, {
      batchId: 'batch-2', sourceWatermark: 1234, sourceRange: 'users.updated_at',
      sourceCursor: null, pageCount: 2, sourceCount: 4, comparedCount: 4,
      differenceCount: 0, sourceExhausted: true, completed: true, failed: false,
    })).resolves.toMatchObject({
      candidateReady: true,
      unclassifiedDifferences: 0,
      sourceCursor: null,
      sourceWatermark: 1234,
      checkpointComplete: true,
    });
  });
});