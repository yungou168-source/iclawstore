import { describe, expect, it, vi } from "bun:test";
import {
  createPublisherAccessPort,
  decidePublisherAccess,
  type PublisherAccessFacts,
} from "../src/domains/publishers/publisherAccess.js";
import {
  reconcilePublisherAvatar,
  reconcilePublisherDatasets,
  type PublisherReconciliationDataset,
} from "../src/domains/publishers/publisherReconciliation.js";
import { runPublisherReconciliation } from "../src/domains/publishers/publisherReconciliationRunner.js";

const baseFacts = (overrides: Partial<PublisherAccessFacts> = {}): PublisherAccessFacts => ({
  actorLegacyUserId: "users:owner",
  actorActive: true,
  actorPlatformRole: null,
  publisher: {
    legacyConvexId: "publishers:org",
    kind: "org",
    active: true,
    linkedUserLegacyConvexId: null,
  },
  membershipRole: "owner",
  targetMembershipRole: "publisher",
  activeOwnerCount: 2,
  ...overrides,
});

const publisher = {
  legacyConvexId: "publishers:org",
  legacyCreationTime: 1,
  kind: "org" as const,
  handle: "acme",
  displayName: "Acme",
  bio: null,
  image: null,
  imageStorageId: null,
  linkedUserLegacyConvexId: null,
  trustedPublisher: false,
  publishedSkills: 1,
  publishedPackages: 0,
  totalInstalls: 2,
  totalDownloads: 3,
  totalStars: 4,
  skillTotalInstalls: 2,
  skillTotalDownloads: 3,
  skillTotalStars: 4,
  deletedAt: null,
  deactivatedAt: null,
  legacyCreatedAt: 10,
  legacyUpdatedAt: 20,
};

const owner = {
  legacyConvexId: "publisherMembers:owner",
  legacyCreationTime: 2,
  publisherLegacyConvexId: publisher.legacyConvexId,
  memberUserLegacyConvexId: "users:owner",
  role: "owner" as const,
  legacyCreatedAt: 11,
  legacyUpdatedAt: 21,
};

const official = {
  legacyConvexId: "officialPublishers:acme",
  legacyCreationTime: 3,
  publisherLegacyConvexId: publisher.legacyConvexId,
  reason: "verified",
  createdByUserLegacyConvexId: "users:platform-admin",
  legacyCreatedAt: 12,
  legacyUpdatedAt: 22,
};

const dataset = (
  overrides: Partial<PublisherReconciliationDataset> = {},
): PublisherReconciliationDataset => ({
  publishers: [publisher],
  members: [owner],
  officialPublishers: [official],
  users: new Map([
    ["users:owner", { active: true, platformRole: "user" as const }],
    ["users:platform-admin", { active: true, platformRole: "admin" as const }],
  ]),
  ...overrides,
});

describe("PublisherAccessPort", () => {
  it("applies role rank to publish and profile update without becoming a production authorization dependency", () => {
    const port = createPublisherAccessPort();
    expect(port.decide("publish", baseFacts({ membershipRole: "publisher" }))).toEqual({
      allowed: true,
      reason: "allowed",
    });
    expect(port.decide("profile_update", baseFacts({ membershipRole: "publisher" }))).toEqual({
      allowed: false,
      reason: "insufficient_role",
    });
    expect(port.decide("profile_update", baseFacts({ membershipRole: "admin" })).allowed).toBe(
      true,
    );
  });

  it("protects owner changes and the last active owner", () => {
    expect(
      decidePublisherAccess(
        "member_remove",
        baseFacts({ membershipRole: "admin", targetMembershipRole: "owner" }),
      ),
    ).toEqual({ allowed: false, reason: "owner_target_protected" });
    expect(decidePublisherAccess("owner_remove", baseFacts({ activeOwnerCount: 1 }))).toEqual({
      allowed: false,
      reason: "last_active_owner",
    });
    expect(decidePublisherAccess("owner_remove", baseFacts({ activeOwnerCount: 2 })).allowed).toBe(
      true,
    );
  });

  it("uses linked user identity for personal Publisher access and keeps platform controls admin-only", () => {
    const personalFacts = baseFacts({
      publisher: {
        legacyConvexId: "publishers:user",
        kind: "user",
        active: true,
        linkedUserLegacyConvexId: "users:owner",
      },
      membershipRole: null,
    });
    expect(decidePublisherAccess("publish", personalFacts).allowed).toBe(true);
    expect(decidePublisherAccess("profile_update", personalFacts)).toEqual({
      allowed: false,
      reason: "organization_required",
    });
    expect(decidePublisherAccess("official_manage", personalFacts)).toEqual({
      allowed: false,
      reason: "platform_admin_required",
    });
    expect(
      decidePublisherAccess("official_manage", {
        ...personalFacts,
        actorPlatformRole: "admin",
      }).allowed,
    ).toBe(true);
  });

  it("fails closed for inactive actors and Publishers", () => {
    expect(decidePublisherAccess("publish", baseFacts({ actorActive: false }))).toEqual({
      allowed: false,
      reason: "actor_inactive",
    });
    expect(
      decidePublisherAccess(
        "publish",
        baseFacts({
          publisher: { ...baseFacts().publisher, active: false },
        }),
      ),
    ).toEqual({ allowed: false, reason: "publisher_inactive" });
  });
});

describe("Publisher reconciliation", () => {
  it("is ready when Publisher, member, official and permission facts match", () => {
    expect(reconcilePublisherDatasets(dataset(), dataset())).toEqual([]);
  });

  it("reports field, membership and permission decision mismatches", () => {
    const differences = reconcilePublisherDatasets(
      dataset(),
      dataset({
        publishers: [{ ...publisher, displayName: "Different" }],
        members: [{ ...owner, role: "publisher" }],
        users: new Map([
          ["users:owner", { active: true, platformRole: "user" as const }],
          ["users:platform-admin", { active: true, platformRole: "user" as const }],
        ]),
      }),
    );

    expect(differences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldName: "displayName", differenceKind: "value_mismatch" }),
        expect.objectContaining({ fieldName: "role", differenceKind: "value_mismatch" }),
        expect.objectContaining({
          fieldName: "permission.profile_update",
          differenceKind: "decision_mismatch",
        }),
        expect.objectContaining({
          fieldName: "permission.org_delete",
          differenceKind: "decision_mismatch",
        }),
        expect.objectContaining({
          fieldName: "permission.official_manage",
          differenceKind: "decision_mismatch",
        }),
      ]),
    );
  });

  it("reports canonical identity, owner, personal membership, official and orphan invariants", () => {
    const personal = {
      ...publisher,
      legacyConvexId: "publishers:user",
      kind: "user" as const,
      handle: "acme",
      linkedUserLegacyConvexId: "users:personal",
    };
    const orphanMember = {
      ...owner,
      legacyConvexId: "publisherMembers:orphan",
      publisherLegacyConvexId: "publishers:missing",
    };
    const invalidOfficial = {
      ...official,
      legacyConvexId: "officialPublishers:user",
      publisherLegacyConvexId: personal.legacyConvexId,
    };
    const invalid = dataset({
      publishers: [publisher, personal],
      members: [orphanMember],
      officialPublishers: [invalidOfficial],
      users: new Map([
        ["users:owner", { active: true, platformRole: "user" as const }],
        ["users:personal", { active: true, platformRole: "user" as const }],
      ]),
    });

    const differences = reconcilePublisherDatasets(invalid, invalid);
    expect(differences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldName: "source.handle",
          differenceKind: "invariant_violation",
        }),
        expect.objectContaining({
          fieldName: "source.activeOwners",
          differenceKind: "invariant_violation",
        }),
        expect.objectContaining({
          fieldName: "source.personalOwnerMembership",
          differenceKind: "invariant_violation",
        }),
        expect.objectContaining({
          fieldName: "source.officialPublisher",
          differenceKind: "invariant_violation",
        }),
        expect.objectContaining({
          fieldName: "source.publisher",
          differenceKind: "invariant_violation",
        }),
      ]),
    );
  });
});

describe("Publisher avatar reconciliation", () => {
  it("compares source storage ID, MIME, bytes and SHA-256", () => {
    const source = { mimeType: "image/png", sizeBytes: 4, sha256: "a".repeat(64) };
    expect(
      reconcilePublisherAvatar("publishers:org", "storage:avatar", source, {
        legacyStorageId: "storage:avatar",
        mimeType: "image/png",
        sizeBytes: 4,
        sha256: "a".repeat(64),
        assetStatus: "active",
        snapshotStatus: "active",
      }),
    ).toEqual([]);
    expect(
      reconcilePublisherAvatar("publishers:org", "storage:avatar", source, {
        legacyStorageId: "storage:avatar",
        mimeType: "image/png",
        sizeBytes: 5,
        sha256: "b".repeat(64),
        assetStatus: "active",
        snapshotStatus: "active",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldName: "avatar.sizeBytes" }),
        expect.objectContaining({ fieldName: "avatar.sha256" }),
      ]),
    );
  });
});

const sideFor = (input: PublisherReconciliationDataset) => ({
  publishers: async function* () {
    yield* input.publishers;
  },
  members: async function* () {
    yield* input.members;
  },
  officialPublishers: async function* () {
    yield* input.officialPublishers;
  },
  users: vi.fn(
    async (legacyUserIds: readonly string[]) =>
      new Map(
        legacyUserIds.map((legacyUserId) => [
          legacyUserId,
          input.users.get(legacyUserId) ?? { active: false, platformRole: null },
        ]),
      ),
  ),
  avatarMetadata: vi.fn(async () => null),
  findAvatar: vi.fn(async () => null),
});

describe("Publisher reconciliation runner", () => {
  it("records only evidence and never changes authorization state", async () => {
    const source = sideFor(dataset());
    const target = sideFor(dataset({ members: [{ ...owner, role: "admin" }] }));
    const record = vi.fn(async () => undefined);

    const summary = await runPublisherReconciliation({
      batchId: "publisher-reconciliation-1",
      source,
      target,
      sink: { record },
    });

    expect(summary).toMatchObject({
      batchId: "publisher-reconciliation-1",
      sourcePublishers: 1,
      targetPublishers: 1,
      sourceMembers: 1,
      targetMembers: 1,
      candidateReady: false,
    });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: "publisher-reconciliation-1",
        classification: "unclassified",
        fieldName: "role",
      }),
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        differenceKind: "decision_mismatch",
        fieldName: "permission.owner_remove",
      }),
    );
    expect(source.users).toHaveBeenCalledWith(expect.arrayContaining(["users:owner"]));
  });
});
