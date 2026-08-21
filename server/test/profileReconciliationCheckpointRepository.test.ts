import { describe, expect, it, mock } from 'bun:test';
import { createProfileReconciliationCheckpointRepository } from '../src/domains/profiles/profileReconciliationCheckpointRepository.js';

describe('Profile reconciliation checkpoint repository', () => {
  it('starts once and advances the cursor only after a completed page', async () => {
    const query = mock(async () => [{ affectedRows: 1 }, []]);
    const repository = createProfileReconciliationCheckpointRepository({ query });

    await repository.start({ batchId: 'batch-1', sourceWatermark: 1234, sourceRange: 'users.updated_at:0' });
    await repository.advance({
      batchId: 'batch-1', sourceCursor: 'opaque-next-cursor', sourceCount: 2,
      comparedCount: 2, differenceCount: 3, sourceExhausted: false,
    });

    expect(query.mock.calls[0]?.[0]).toContain('INSERT INTO profile_reconciliation_checkpoints');
    expect(query.mock.calls[1]?.[0]).toContain('UPDATE profile_reconciliation_checkpoints');
    expect(query.mock.calls[1]?.[1]).toEqual(['opaque-next-cursor', 2, 2, 3, false, 'batch-1']);
  });

  it('resumes from the committed cursor and rejects a changed source watermark', async () => {
    const pages = [
      { profiles: [], nextCursor: 'next', done: false, watermark: 42 },
      { profiles: [], nextCursor: null, done: true, watermark: 42 },
    ];
    const reads: unknown[] = [];
    const commits: unknown[] = [];
    const finalize = mock(async () => undefined);
    const { runProfileReconciliationPages } = await import('../src/domains/profiles/profileReconciliationRunner.js');

    await runProfileReconciliationPages({
      checkpoint: {
        sourceCursor: 'saved-cursor', sourceWatermark: 42, sourceProfiles: 1,
        comparedProfiles: 1, differences: 0, sourceExhausted: false, completed: false,
      },
      source: {
        readPage: mock(async (input) => {
          reads.push(input);
          return pages.shift()!;
        }),
      },
      commitPage: mock(async (page) => { commits.push(page); }),
      finalize,
    });

    expect(reads).toEqual([
      { cursor: 'saved-cursor', watermark: 42 },
      { cursor: 'next', watermark: 42 },
    ]);
    expect(commits).toHaveLength(2);
    expect(finalize).toHaveBeenCalledTimes(1);

    const resumedFinalization = mock(async () => undefined);
    await runProfileReconciliationPages({
      checkpoint: {
        sourceCursor: null, sourceWatermark: 42, sourceProfiles: 2,
        comparedProfiles: 2, differences: 0, sourceExhausted: true, completed: false,
      },
      source: { readPage: mock(async () => { throw new Error('source must not be reread'); }) },
      commitPage: mock(async () => undefined),
      finalize: resumedFinalization,
    });
    expect(resumedFinalization).toHaveBeenCalledTimes(1);

    await expect(runProfileReconciliationPages({
      checkpoint: {
        sourceCursor: null, sourceWatermark: 42, sourceProfiles: 0,
        comparedProfiles: 0, differences: 0, sourceExhausted: false, completed: false,
      },
      source: { readPage: mock(async () => ({ profiles: [], nextCursor: null, done: true, watermark: 43 })) },
      commitPage: mock(async () => undefined),
      finalize: mock(async () => undefined),
    })).rejects.toThrow('source watermark changed');
  });
});