import { describe, expect, it, mock } from 'bun:test';
import { reconcileProfileProjectionPage, runProfileProjectionReconciliationToCompletion } from '../src/domains/profile-projections/profileProjectionReconciliationRunner.js';

const catalog = {
  publisherLegacyConvexId: 'publishers:one', publisherHandle: 'one',
  item: { legacyConvexId: 'skills:one', kind: 'skill' as const, displayName: 'One', href: '/one/one', canonicalStats: { downloads: 1, stars: 1 }, isOfficial: false, updatedAt: 1 },
};

describe('profile projection reconciliation runner', () => {
  it('records differences and advances a completed phase checkpoint', async () => {
    const checkpoint = { load: mock(async () => null), start: mock(async () => {}), advance: mock(async () => {}), fail: mock(async () => {}) };
    const sink = { record: mock(async () => {}) };
    const result = await reconcileProfileProjectionPage({
      batchId: 'batch-1', phase: 'catalog', batchSize: 10,
      source: { listCatalogItems: async () => ({ items: [catalog], cursor: null, done: true }), listPackageItems: async () => ({ items: [], cursor: null, done: true }), listStarredItems: async () => ({ items: [], cursor: null, done: true }), listManifests: async () => ({ items: [], cursor: null, done: true }) },
      target: async () => [], checkpoint, sink,
    });
    expect(result).toEqual({ done: true, sourceCount: 1, differences: 1 });
    expect(sink.record).toHaveBeenCalledWith(expect.objectContaining({ batchId: 'batch-1', classification: 'unclassified' }));
    expect(checkpoint.advance).toHaveBeenCalledWith(expect.objectContaining({ completed: true, cursor: null }));
  });

  it('runs each incomplete phase to completion in order', async () => {
    const checkpoints = new Map<string, { sourceCursor: string | null; completed: boolean }>();
    const phases: string[] = [];
    const checkpoint = {
      load: async (_batchId: string, phase: string) => checkpoints.get(phase) ?? null,
      start: async () => {},
      advance: async (input: { phase: string; cursor: string | null; completed: boolean }) => {
        checkpoints.set(input.phase, { sourceCursor: input.cursor, completed: input.completed });
      },
      fail: async () => {},
    };
    const page = (phase: string) => async () => {
      phases.push(phase);
      return { items: [], cursor: null, done: true };
    };
    const result = await runProfileProjectionReconciliationToCompletion({
      batchId: 'batch-1', batchSize: 10, checkpoint, sink: { record: async () => {} },
      target: async () => [],
      source: {
        listCatalogItems: page('catalog'), listPackageItems: page('packages'),
        listStarredItems: page('starred'), listManifests: page('manifests'),
      },
    });
    expect(result).toEqual({ sourceCount: 0, differences: 0 });
    expect(phases).toEqual(['catalog', 'packages', 'starred', 'manifests']);
  });
});