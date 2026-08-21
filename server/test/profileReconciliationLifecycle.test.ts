import { describe, expect, it, mock } from 'bun:test';
import { createProfileReconciliationLifecycle } from '../src/domains/profiles/profileReconciliationLifecycle.js';

describe('Profile reconciliation lifecycle', () => {
  it('requires an explicit classification before waiver or closure', async () => {
    const query = mock(async () => [{ affectedRows: 1 }, []]);
    const lifecycle = createProfileReconciliationLifecycle({ query });

    await lifecycle.classify({
      recordKey: 'a'.repeat(64), classification: 'expected_transform',
      reason: 'normalized legacy alias', actor: 'migration-reviewer',
      sourceEvidence: { alias: 'source' }, targetEvidence: { alias: 'target' }, evidenceHash: 'b'.repeat(64),
    });
    await lifecycle.waive({ recordKey: 'a'.repeat(64), reason: 'approved transform', actor: 'migration-reviewer' });
    await lifecycle.close({ recordKey: 'a'.repeat(64), reason: 'verified in candidate', actor: 'migration-reviewer' });

    expect(query.mock.calls[0]?.[0]).toContain('classificationReason');
    expect(query.mock.calls[1]?.[0]).toContain("classification <> 'unclassified'");
    expect(query.mock.calls[2]?.[0]).toContain('resolvedAt = CURRENT_TIMESTAMP(3)');
  });

  it('rejects empty audit reasons and actors', async () => {
    const lifecycle = createProfileReconciliationLifecycle({ query: mock(async () => [{ affectedRows: 0 }, []]) });
    await expect(lifecycle.classify({
      recordKey: 'a'.repeat(64), classification: 'source_bug', reason: ' ', actor: 'reviewer',
      sourceEvidence: { alias: 'source' }, targetEvidence: { alias: 'target' }, evidenceHash: 'b'.repeat(64),
    })).rejects.toThrow('classification reason is required');
  });
});