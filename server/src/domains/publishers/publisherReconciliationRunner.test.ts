import { describe, expect, it } from 'vitest';
import { runPublisherReconciliation } from './publisherReconciliationRunner.js';

const iterable = async function* <T>(values: readonly T[]) { yield* values; };

const emptySide = Object.freeze({
  publishers: () => iterable([]),
  members: () => iterable([]),
  officialPublishers: () => iterable([]),
  users: async () => new Map(),
});

describe('publisher reconciliation retention classification', () => {
  it('keeps an exact attested target-only fixture visible while unrelated differences remain blocking', async () => {
    const recorded: unknown[] = [];
    const summary = await runPublisherReconciliation({
      batchId: 'batch-1',
      source: { ...emptySide, avatarMetadata: async () => null },
      target: {
        ...emptySide,
        publishers: () => iterable([{
          legacyConvexId: 'legacy-org', legacyCreationTime: 1, kind: 'org', handle: 'candidate-e2e-org',
          displayName: 'retired fixture', bio: null, image: null, imageStorageId: null,
          linkedUserLegacyConvexId: null, trustedPublisher: false, publishedSkills: 0, publishedPackages: 0,
          totalInstalls: 0, totalDownloads: 0, totalStars: 0, skillTotalInstalls: 0,
          skillTotalDownloads: 0, skillTotalStars: 0, deletedAt: null, deactivatedAt: null,
          legacyCreatedAt: 1, legacyUpdatedAt: 1,
        }]),
        findAvatar: async () => null,
      },
      classifyDifference: async (difference) =>
        difference.legacyConvexId === 'legacy-org' && difference.fieldName === 'publisher'
          ? 'expected_retired_fixture'
          : 'unclassified',
      sink: { record: async (difference) => { recorded.push(difference); } },
    });

    expect(summary).toMatchObject({ differences: 2, unclassifiedDifferences: 1, retainedFixtureDifferences: 1, candidateReady: false });
    expect(recorded).toContainEqual(expect.objectContaining({ classification: 'expected_retired_fixture' }));
  });
});