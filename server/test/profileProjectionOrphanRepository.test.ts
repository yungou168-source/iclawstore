import { describe, expect, it } from 'bun:test';
import { createProfileProjectionOrphanRepository } from '../src/domains/profile-projections/profileProjectionOrphanRepository.js';

describe('profile projection orphan repository', () => {
  it('turns target-only relation failures into invariant differences', async () => {
    let calls = 0;
    const repository = createProfileProjectionOrphanRepository({
      query: async () => {
        calls += 1;
        return calls === 4
          ? [[{ legacyConvexId: 'entry-1', fieldName: 'publisher_boundary', summary: 'manifest entry does not share the section and catalog publisher' }], []]
          : [[], []];
      },
    });
    expect(await repository.list()).toEqual([{
      legacyConvexId: 'entry-1', fieldName: 'publisher_boundary',
      differenceKind: 'invariant_violation',
      summary: 'manifest entry does not share the section and catalog publisher',
    }]);
  });
});