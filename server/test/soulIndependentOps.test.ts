import { describe, expect, it } from 'vitest';
import { assessSoulReconciliationGate, createSoulReconciliationRunner } from '../src/domains/souls/soulReconciliationGate.js';
import { assertSoulOpsCanExecute, parseSoulOpsRequest } from '../src/domains/souls/soulMigrationOps.js';

describe('independent Soul operations', () => {
  it('fails the candidate gate for watermark and asset differences', () => {
    const result = assessSoulReconciliationGate({
      differences: [{ legacyConvexId: 'soul:1', fieldName: 'file', differenceKind: 'value_mismatch', summary: 'hash differs' }],
      missingAssets: 1,
      watermark: 'source-a',
      targetWatermark: 'source-b',
      completed: true,
    });
    expect(result.ready).toBe(false);
    expect(result.reason).toBe('watermark_mismatch');
  });

  it('persists a timestamped reconciliation report without file contents', async () => {
    let persisted: unknown;
    const runner = createSoulReconciliationRunner({
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      persist: async (report) => { persisted = report; },
    });
    await expect(runner({ batchId: 'batch-1', watermark: 'w1', sourceCount: 1, targetCount: 1, differenceCount: 0, missingAssetCount: 0, candidateReady: true })).resolves.toMatchObject({ generatedAt: '2026-01-01T00:00:00.000Z' });
    expect(persisted).toMatchObject({ batchId: 'batch-1', candidateReady: true });
  });

  it('defaults operations to dry-run and requires explicit execution confirmation', () => {
    const request = parseSoulOpsRequest(['asset-copy'], { SOUL_MIGRATION_OPERATOR: 'ops:1' });
    expect(request.dryRun).toBe(true);
    expect(() => assertSoulOpsCanExecute({ ...request, dryRun: false }, { SOUL_MIGRATION_OPERATOR: 'ops:1' })).toThrow('SOUL_MIGRATION_CONFIRM');
    expect(() => assertSoulOpsCanExecute({ ...request, dryRun: false }, { SOUL_MIGRATION_OPERATOR: 'ops:1', SOUL_MIGRATION_CONFIRM: 'yes' })).not.toThrow();
  });
});