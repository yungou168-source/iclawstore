import type { PublisherKind, PublisherRole } from "./publisherMigrationSource.js";

export type PublisherAccessOperation =
  | "publish"
  | "profile_update"
  | "member_upsert"
  | "member_remove"
  | "owner_promote"
  | "owner_remove"
  | "org_delete"
  | "official_manage"
  | "trusted_manage";

export type PublisherAccessFacts = Readonly<{
  actorLegacyUserId: string;
  actorActive: boolean;
  actorPlatformRole: "admin" | "moderator" | "user" | null;
  publisher: Readonly<{
    legacyConvexId: string;
    kind: PublisherKind;
    active: boolean;
    linkedUserLegacyConvexId: string | null;
  }>;
  membershipRole: PublisherRole | null;
  legacyOwnerUserId?: string | null;
  targetMembershipRole?: PublisherRole | null;
  activeOwnerCount?: number;
}>;

export type PublisherAccessDecision = Readonly<{
  allowed: boolean;
  reason:
    | "allowed"
    | "actor_inactive"
    | "publisher_inactive"
    | "personal_owner_mismatch"
    | "organization_required"
    | "membership_required"
    | "insufficient_role"
    | "owner_required"
    | "owner_target_protected"
    | "last_active_owner"
    | "platform_admin_required";
}>;

export type PublisherAccessPort = Readonly<{
  decide: (
    operation: PublisherAccessOperation,
    facts: PublisherAccessFacts,
  ) => PublisherAccessDecision;
}>;

const roleRank: Record<PublisherRole, number> = {
  publisher: 1,
  admin: 2,
  owner: 3,
};

const allow = (): PublisherAccessDecision => ({ allowed: true, reason: "allowed" });
const deny = (
  reason: Exclude<PublisherAccessDecision["reason"], "allowed">,
): PublisherAccessDecision => ({
  allowed: false,
  reason,
});

const hasRole = (actual: PublisherRole | null, minimum: PublisherRole): boolean =>
  actual !== null && roleRank[actual] >= roleRank[minimum];

const personalOwnerAllowed = (facts: PublisherAccessFacts): boolean =>
  facts.publisher.linkedUserLegacyConvexId
    ? facts.publisher.linkedUserLegacyConvexId === facts.actorLegacyUserId
    : facts.legacyOwnerUserId === facts.actorLegacyUserId;

const decidePublisherScope = (
  facts: PublisherAccessFacts,
  minimumRole: PublisherRole,
): PublisherAccessDecision => {
  if (!facts.actorActive) return deny("actor_inactive");
  if (!facts.publisher.active) return deny("publisher_inactive");
  if (facts.publisher.kind === "user") {
    return personalOwnerAllowed(facts) ? allow() : deny("personal_owner_mismatch");
  }
  if (!facts.membershipRole) return deny("membership_required");
  return hasRole(facts.membershipRole, minimumRole) ? allow() : deny("insufficient_role");
};

export const decidePublisherAccess = (
  operation: PublisherAccessOperation,
  facts: PublisherAccessFacts,
): PublisherAccessDecision => {
  if (operation === "official_manage" || operation === "trusted_manage") {
    if (!facts.actorActive) return deny("actor_inactive");
    return facts.actorPlatformRole === "admin" ? allow() : deny("platform_admin_required");
  }

  if (operation === "publish") return decidePublisherScope(facts, "publisher");
  if (operation === "profile_update") {
    if (facts.publisher.kind !== "org") return deny("organization_required");
    return decidePublisherScope(facts, "admin");
  }
  if (facts.publisher.kind !== "org") return deny("organization_required");

  const ownerOnly =
    operation === "owner_promote" || operation === "owner_remove" || operation === "org_delete";
  const actorDecision = decidePublisherScope(facts, ownerOnly ? "owner" : "admin");
  if (!actorDecision.allowed) return actorDecision;

  if (
    (operation === "member_upsert" || operation === "member_remove") &&
    facts.targetMembershipRole === "owner" &&
    facts.membershipRole !== "owner"
  ) {
    return deny("owner_target_protected");
  }
  if (operation === "owner_promote" && facts.membershipRole !== "owner") {
    return deny("owner_required");
  }
  if (operation === "owner_remove") {
    if (facts.membershipRole !== "owner") return deny("owner_required");
    if ((facts.activeOwnerCount ?? 0) <= 1) return deny("last_active_owner");
  }
  return allow();
};

export const createPublisherAccessPort = (): PublisherAccessPort =>
  Object.freeze({ decide: decidePublisherAccess });
