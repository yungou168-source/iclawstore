import type {
  OfficialPublisherSourceSnapshot,
  PublisherMemberSourceSnapshot,
  PublisherSourceSnapshot,
} from "./publisherMigrationSource.js";
import {
  reconcilePublisherAvatar,
  reconcilePublisherDatasets,
  type PublisherAvatarSourceMetadata,
  type PublisherAvatarTargetMetadata,
  type PublisherReconciliationDataset,
  type PublisherReconciliationDifference,
  type PublisherReconciliationUser,
} from "./publisherReconciliation.js";

export type PublisherReconciliationSide = Readonly<{
  publishers: () => AsyncIterable<PublisherSourceSnapshot>;
  members: () => AsyncIterable<PublisherMemberSourceSnapshot>;
  officialPublishers: () => AsyncIterable<OfficialPublisherSourceSnapshot>;
  users: (
    legacyUserIds: readonly string[],
  ) => Promise<ReadonlyMap<string, PublisherReconciliationUser>>;
}>;

export type PublisherReconciliationSource = PublisherReconciliationSide &
  Readonly<{
    avatarMetadata: (storageId: string) => Promise<PublisherAvatarSourceMetadata | null>;
  }>;

export type PublisherReconciliationTarget = PublisherReconciliationSide &
  Readonly<{
    findAvatar: (storageId: string) => Promise<PublisherAvatarTargetMetadata | null>;
  }>;

export type PublisherReconciliationClassification = 'expected_retired_fixture' | 'unclassified';

export type PublisherReconciliationSink = Readonly<{
  record: (
    input: PublisherReconciliationDifference &
      Readonly<{
        batchId: string;
        classification: PublisherReconciliationClassification;
      }>,
  ) => Promise<void>;
}>;

export type PublisherReconciliationSummary = Readonly<{
  batchId: string;
  sourcePublishers: number;
  targetPublishers: number;
  sourceMembers: number;
  targetMembers: number;
  sourceOfficialPublishers: number;
  targetOfficialPublishers: number;
  differences: number;
  unclassifiedDifferences: number;
  retainedFixtureDifferences: number;
  candidateReady: boolean;
}>;

const collect = async <T>(items: AsyncIterable<T>): Promise<T[]> => {
  const collected: T[] = [];
  for await (const item of items) collected.push(item);
  return collected;
};

const userIdsFor = (
  publishers: readonly PublisherSourceSnapshot[],
  members: readonly PublisherMemberSourceSnapshot[],
  officialPublishers: readonly OfficialPublisherSourceSnapshot[],
): string[] => [
  ...new Set([
    ...publishers.flatMap((publisher) =>
      publisher.linkedUserLegacyConvexId ? [publisher.linkedUserLegacyConvexId] : [],
    ),
    ...members.map((member) => member.memberUserLegacyConvexId),
    ...officialPublishers.flatMap((official) =>
      official.createdByUserLegacyConvexId ? [official.createdByUserLegacyConvexId] : [],
    ),
  ]),
];

const loadDataset = async (
  side: PublisherReconciliationSide,
): Promise<PublisherReconciliationDataset> => {
  const [publishers, members, officialPublishers] = await Promise.all([
    collect(side.publishers()),
    collect(side.members()),
    collect(side.officialPublishers()),
  ]);
  return {
    publishers,
    members,
    officialPublishers,
    users: await side.users(userIdsFor(publishers, members, officialPublishers)),
  };
};

export const runPublisherReconciliation = async (
  input: Readonly<{
    batchId: string;
    source: PublisherReconciliationSource;
    target: PublisherReconciliationTarget;
    sink: PublisherReconciliationSink;
    classifyDifference?: (
      difference: PublisherReconciliationDifference,
    ) => Promise<PublisherReconciliationClassification>;
  }>,
): Promise<PublisherReconciliationSummary> => {
  const [source, target] = await Promise.all([
    loadDataset(input.source),
    loadDataset(input.target),
  ]);
  const differences = reconcilePublisherDatasets(source, target);
  for (const publisher of source.publishers) {
    if (publisher.kind !== "org" || !publisher.imageStorageId) continue;
    const [sourceAvatar, targetAvatar] = await Promise.all([
      input.source.avatarMetadata(publisher.imageStorageId),
      input.target.findAvatar(publisher.imageStorageId),
    ]);
    differences.push(
      ...reconcilePublisherAvatar(
        publisher.legacyConvexId,
        publisher.imageStorageId,
        sourceAvatar,
        targetAvatar,
      ),
    );
  }
  let retainedFixtureDifferences = 0;
  for (const difference of differences) {
    const classification = await input.classifyDifference?.(difference) ?? "unclassified";
    if (classification === 'expected_retired_fixture') retainedFixtureDifferences += 1;
    await input.sink.record({
      ...difference,
      batchId: input.batchId,
      classification,
    });
  }
  const unclassifiedDifferences = differences.length - retainedFixtureDifferences;
  return {
    batchId: input.batchId,
    sourcePublishers: source.publishers.length,
    targetPublishers: target.publishers.length,
    sourceMembers: source.members.length,
    targetMembers: target.members.length,
    sourceOfficialPublishers: source.officialPublishers.length,
    targetOfficialPublishers: target.officialPublishers.length,
    differences: differences.length,
    unclassifiedDifferences,
    retainedFixtureDifferences,
    candidateReady: unclassifiedDifferences === 0,
  };
};
