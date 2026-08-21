import { describe, expect, it } from 'bun:test';
import { reconcileProfileProjectionPhase } from '../src/domains/profile-projections/profileProjectionReconciliation.js';

const catalog = (id: string, displayName = 'Skill') => ({
  publisherLegacyConvexId: 'publishers:one',
  publisherHandle: 'one',
  item: {
    legacyConvexId: id,
    kind: 'skill' as const,
    displayName,
    href: '/one/skill',
    canonicalStats: { downloads: 1, stars: 2 },
    isOfficial: false,
    updatedAt: 1,
  },
});

describe('profile projection reconciliation', () => {
  it('reports target-only and field-level catalog differences', () => {
    expect(reconcileProfileProjectionPhase({
      phase: 'catalog',
      source: [catalog('skills:one')],
      target: [catalog('skills:one', 'Changed'), catalog('skills:orphan')],
    })).toEqual([
      expect.objectContaining({ legacyConvexId: 'skills:one', fieldName: 'item', differenceKind: 'value_mismatch' }),
      expect.objectContaining({ legacyConvexId: 'skills:orphan', fieldName: 'record', differenceKind: 'missing', summary: 'source projection is absent' }),
    ]);
  });

  it('keys stars by viewer and skill instead of profile publisher', () => {
    const source = {
      viewerUserLegacyConvexId: 'users:viewer',
      starredAt: 10,
      item: catalog('skills:other-owner').item,
    };
    expect(reconcileProfileProjectionPhase({ phase: 'starred', source: [source], target: [source] })).toEqual([]);
  });
});