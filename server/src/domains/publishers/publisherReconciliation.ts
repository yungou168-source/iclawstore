import {
  decidePublisherAccess,
  type PublisherAccessFacts,
  type PublisherAccessOperation,
} from "./publisherAccess.js";
import type {
  OfficialPublisherSourceSnapshot,
  PublisherMemberSourceSnapshot,
  PublisherSourceSnapshot,
} from "./publisherMigrationSource.js";

export type PublisherReconciliationUser = Readonly<{
  active: boolean;
  platformRole: "admin" | "moderator" | "user" | null;
}>;

export type PublisherReconciliationDataset = Readonly<{
  publishers: readonly PublisherSourceSnapshot[];
  members: readonly PublisherMemberSourceSnapshot[];
  officialPublishers: readonly OfficialPublisherSourceSnapshot[];
  users: ReadonlyMap<string, PublisherReconciliationUser>;
}>;

export type PublisherAvatarSourceMetadata = Readonly<{
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}>;

export type PublisherAvatarTargetMetadata = Readonly<{
  legacyStorageId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  assetStatus: "active" | "deleted";
  snapshotStatus: string;
}>;

export type PublisherReconciliationDifference = Readonly<{
  legacyConvexId: string;
  fieldName: string;
  differenceKind: "missing" | "value_mismatch" | "invariant_violation" | "decision_mismatch";
  summary: string;
}>;

const publisherFields = [
  "kind",
  "handle",
  "displayName",
  "bio",
  "image",
  "imageStorageId",
  "linkedUserLegacyConvexId",
  "trustedPublisher",
  "publishedSkills",
  "publishedPackages",
  "totalInstalls",
  "totalDownloads",
  "totalStars",
  "skillTotalInstalls",
  "skillTotalDownloads",
  "skillTotalStars",
  "deletedAt",
  "deactivatedAt",
  "legacyCreationTime",
  "legacyCreatedAt",
  "legacyUpdatedAt",
] as const;

const memberFields = [
  "publisherLegacyConvexId",
  "memberUserLegacyConvexId",
  "role",
  "legacyCreationTime",
  "legacyCreatedAt",
  "legacyUpdatedAt",
] as const;

const officialFields = [
  "publisherLegacyConvexId",
  "reason",
  "createdByUserLegacyConvexId",
  "legacyCreationTime",
  "legacyCreatedAt",
  "legacyUpdatedAt",
] as const;

const sameComparableField = (fieldName: PropertyKey, sourceValue: unknown, targetValue: unknown): boolean => {
  if (fieldName !== "legacyCreationTime") return sourceValue === targetValue;
  if (typeof sourceValue !== "number" || typeof targetValue !== "number") {
    return sourceValue === targetValue;
  }
  return Math.round(sourceValue) === Math.round(targetValue);
};

const compareRecord = <T extends Readonly<{ legacyConvexId: string }>>(
  entityName: string,
  fields: readonly (keyof T)[],
  source: T | null,
  target: T | null,
): PublisherReconciliationDifference[] => {
  const legacyConvexId = source?.legacyConvexId ?? target?.legacyConvexId;
  if (!legacyConvexId || (!source && !target)) return [];
  if (!target) {
    return [
      {
        legacyConvexId,
        fieldName: entityName,
        differenceKind: "missing",
        summary: `target ${entityName} is absent`,
      },
    ];
  }
  if (!source) {
    return [
      {
        legacyConvexId,
        fieldName: entityName,
        differenceKind: "missing",
        summary: `source ${entityName} is absent`,
      },
    ];
  }
  return fields.flatMap((fieldName) =>
    sameComparableField(fieldName, source[fieldName], target[fieldName])
      ? []
      : [
          {
            legacyConvexId,
            fieldName: String(fieldName),
            differenceKind: "value_mismatch" as const,
            summary: `${String(fieldName)} differs`,
          },
        ],
  );
};

const byLegacyId = <T extends Readonly<{ legacyConvexId: string }>>(items: readonly T[]) =>
  new Map(items.map((item) => [item.legacyConvexId, item]));

const reconcileCollection = <T extends Readonly<{ legacyConvexId: string }>>(
  entityName: string,
  fields: readonly (keyof T)[],
  sourceItems: readonly T[],
  targetItems: readonly T[],
): PublisherReconciliationDifference[] => {
  const source = byLegacyId(sourceItems);
  const target = byLegacyId(targetItems);
  return [...new Set([...source.keys(), ...target.keys()])].flatMap((legacyConvexId) =>
    compareRecord(
      entityName,
      fields,
      source.get(legacyConvexId) ?? null,
      target.get(legacyConvexId) ?? null,
    ),
  );
};

const active = (publisher: PublisherSourceSnapshot): boolean =>
  publisher.deletedAt === null && publisher.deactivatedAt === null;

const datasetInvariantDifferences = (
  dataset: PublisherReconciliationDataset,
  side: "source" | "target",
): PublisherReconciliationDifference[] => {
  const differences: PublisherReconciliationDifference[] = [];
  const publishers = byLegacyId(dataset.publishers);
  const membersByPublisher = new Map<string, PublisherMemberSourceSnapshot[]>();
  const handles = new Map<string, string>();

  for (const publisher of dataset.publishers) {
    const existingHandle = handles.get(publisher.handle);
    if (existingHandle && existingHandle !== publisher.legacyConvexId) {
      differences.push({
        legacyConvexId: publisher.legacyConvexId,
        fieldName: `${side}.handle`,
        differenceKind: "invariant_violation",
        summary: `canonical handle is also used by ${existingHandle}`,
      });
    }
    handles.set(publisher.handle, publisher.legacyConvexId);
    if (publisher.kind === "user" && !publisher.linkedUserLegacyConvexId) {
      differences.push({
        legacyConvexId: publisher.legacyConvexId,
        fieldName: `${side}.linkedUserLegacyConvexId`,
        differenceKind: "invariant_violation",
        summary: "personal Publisher has no linked user",
      });
    }
    if (publisher.kind === "org" && publisher.linkedUserLegacyConvexId) {
      differences.push({
        legacyConvexId: publisher.legacyConvexId,
        fieldName: `${side}.linkedUserLegacyConvexId`,
        differenceKind: "invariant_violation",
        summary: "organization Publisher has a linked user",
      });
    }
    if (
      publisher.kind === "user" &&
      publisher.linkedUserLegacyConvexId &&
      dataset.users.get(publisher.linkedUserLegacyConvexId)?.active !== true &&
      active(publisher)
    ) {
      differences.push({
        legacyConvexId: publisher.legacyConvexId,
        fieldName: `${side}.linkedUserActive`,
        differenceKind: "invariant_violation",
        summary: "active personal Publisher is linked to an inactive or missing user",
      });
    }
  }

  for (const member of dataset.members) {
    const publisher = publishers.get(member.publisherLegacyConvexId);
    if (!publisher) {
      differences.push({
        legacyConvexId: member.legacyConvexId,
        fieldName: `${side}.publisher`,
        differenceKind: "invariant_violation",
        summary: "member references a missing Publisher",
      });
      continue;
    }
    const grouped = membersByPublisher.get(member.publisherLegacyConvexId) ?? [];
    grouped.push(member);
    membersByPublisher.set(member.publisherLegacyConvexId, grouped);
    if (dataset.users.get(member.memberUserLegacyConvexId)?.active !== true) {
      differences.push({
        legacyConvexId: member.legacyConvexId,
        fieldName: `${side}.memberUserActive`,
        differenceKind: "invariant_violation",
        summary: "membership references an inactive or missing user",
      });
    }
  }

  for (const publisher of dataset.publishers) {
    const members = membersByPublisher.get(publisher.legacyConvexId) ?? [];
    if (publisher.kind === "org" && active(publisher)) {
      const activeOwners = members.filter(
        (member) =>
          member.role === "owner" &&
          dataset.users.get(member.memberUserLegacyConvexId)?.active === true,
      );
      if (activeOwners.length === 0) {
        differences.push({
          legacyConvexId: publisher.legacyConvexId,
          fieldName: `${side}.activeOwners`,
          differenceKind: "invariant_violation",
          summary: "active organization has no active owner",
        });
      }
    }
    if (publisher.kind === "user" && publisher.linkedUserLegacyConvexId) {
      const owner = members.find(
        (member) =>
          member.memberUserLegacyConvexId === publisher.linkedUserLegacyConvexId &&
          member.role === "owner",
      );
      if (!owner) {
        differences.push({
          legacyConvexId: publisher.legacyConvexId,
          fieldName: `${side}.personalOwnerMembership`,
          differenceKind: "invariant_violation",
          summary: "personal Publisher owner membership is absent",
        });
      }
    }
  }

  for (const official of dataset.officialPublishers) {
    const publisher = publishers.get(official.publisherLegacyConvexId);
    if (!publisher || publisher.kind !== "org" || !active(publisher)) {
      differences.push({
        legacyConvexId: official.legacyConvexId,
        fieldName: `${side}.officialPublisher`,
        differenceKind: "invariant_violation",
        summary: "official status does not reference an active organization",
      });
    }
  }

  return differences;
};

const permissionOperations: readonly PublisherAccessOperation[] = [
  "publish",
  "profile_update",
  "member_upsert",
  "member_remove",
  "owner_promote",
  "owner_remove",
  "org_delete",
  "official_manage",
  "trusted_manage",
];

const accessFactsFor = (
  dataset: PublisherReconciliationDataset,
  publisher: PublisherSourceSnapshot,
  actorLegacyUserId: string,
): PublisherAccessFacts => {
  const publisherMembers = dataset.members.filter(
    (candidate) => candidate.publisherLegacyConvexId === publisher.legacyConvexId,
  );
  const membership = publisherMembers.find(
    (candidate) => candidate.memberUserLegacyConvexId === actorLegacyUserId,
  );
  return {
    actorLegacyUserId,
    actorActive: dataset.users.get(actorLegacyUserId)?.active === true,
    actorPlatformRole: dataset.users.get(actorLegacyUserId)?.platformRole ?? null,
    publisher: {
      legacyConvexId: publisher.legacyConvexId,
      kind: publisher.kind,
      active: active(publisher),
      linkedUserLegacyConvexId: publisher.linkedUserLegacyConvexId,
    },
    membershipRole: membership?.role ?? null,
    targetMembershipRole: "owner",
    activeOwnerCount: publisherMembers.filter(
      (candidate) =>
        candidate.role === "owner" &&
        dataset.users.get(candidate.memberUserLegacyConvexId)?.active === true,
    ).length,
  };
};

const actorIdsFor = (
  dataset: PublisherReconciliationDataset,
  publisher: PublisherSourceSnapshot,
): string[] => [
  ...new Set([
    ...dataset.members
      .filter((member) => member.publisherLegacyConvexId === publisher.legacyConvexId)
      .map((member) => member.memberUserLegacyConvexId),
    ...(publisher.linkedUserLegacyConvexId ? [publisher.linkedUserLegacyConvexId] : []),
    ...dataset.officialPublishers
      .filter((official) => official.publisherLegacyConvexId === publisher.legacyConvexId)
      .flatMap((official) =>
        official.createdByUserLegacyConvexId ? [official.createdByUserLegacyConvexId] : [],
      ),
  ]),
];

const permissionDifferences = (
  source: PublisherReconciliationDataset,
  target: PublisherReconciliationDataset,
): PublisherReconciliationDifference[] => {
  const targetPublishers = byLegacyId(target.publishers);
  return source.publishers.flatMap((sourcePublisher) => {
    const targetPublisher = targetPublishers.get(sourcePublisher.legacyConvexId);
    if (!targetPublisher) return [];
    return actorIdsFor(source, sourcePublisher).flatMap((actorLegacyUserId) => {
      const sourceFacts = accessFactsFor(source, sourcePublisher, actorLegacyUserId);
      const targetFacts = accessFactsFor(target, targetPublisher, actorLegacyUserId);
      return permissionOperations.flatMap((operation) => {
        const sourceDecision = decidePublisherAccess(operation, sourceFacts);
        const targetDecision = decidePublisherAccess(operation, targetFacts);
        return sourceDecision.allowed === targetDecision.allowed &&
          sourceDecision.reason === targetDecision.reason
          ? []
          : [
              {
                legacyConvexId: `${sourcePublisher.legacyConvexId}:${actorLegacyUserId}`,
                fieldName: `permission.${operation}`,
                differenceKind: "decision_mismatch" as const,
                summary: `${operation} decision differs: source=${sourceDecision.allowed}/${sourceDecision.reason}, target=${targetDecision.allowed}/${targetDecision.reason}`,
              },
            ];
      });
    });
  });
};

export const reconcilePublisherAvatar = (
  publisherLegacyConvexId: string,
  sourceStorageId: string,
  source: PublisherAvatarSourceMetadata | null,
  target: PublisherAvatarTargetMetadata | null,
): PublisherReconciliationDifference[] => {
  if (!source || !target || target.assetStatus !== "active" || target.snapshotStatus !== "active") {
    return [
      {
        legacyConvexId: publisherLegacyConvexId,
        fieldName: "avatar",
        differenceKind: "missing",
        summary: "active organization avatar is absent from one side",
      },
    ];
  }
  const expected = { legacyStorageId: sourceStorageId, ...source };
  const fields = ["legacyStorageId", "mimeType", "sizeBytes", "sha256"] as const;
  return fields.flatMap((fieldName) =>
    expected[fieldName] === target[fieldName]
      ? []
      : [
          {
            legacyConvexId: publisherLegacyConvexId,
            fieldName: `avatar.${fieldName}`,
            differenceKind: "value_mismatch" as const,
            summary: `organization avatar ${fieldName} differs`,
          },
        ],
  );
};

export const reconcilePublisherDatasets = (
  source: PublisherReconciliationDataset,
  target: PublisherReconciliationDataset,
): PublisherReconciliationDifference[] => [
  ...reconcileCollection("publisher", publisherFields, source.publishers, target.publishers),
  ...reconcileCollection("member", memberFields, source.members, target.members),
  ...reconcileCollection(
    "officialPublisher",
    officialFields,
    source.officialPublishers,
    target.officialPublishers,
  ),
  ...datasetInvariantDifferences(source, "source"),
  ...datasetInvariantDifferences(target, "target"),
  ...permissionDifferences(source, target),
];
