import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery } from "./functions";
import { ensurePersonalPublisherForUser } from "./lib/publishers";
import { syncProfileIdentityAliases } from "./users";

const FIXTURE_CONFIRMATION = "candidate-e2e-fixtures";
const FIXTURE_MARKER = "candidate-e2e-fixture: safe to delete";
const FIXTURE_NAMESPACE = "candidate-e2e";
const LEGACY_STATIC_USER_HANDLE = "candidate-e2e-user";
const LEGACY_STATIC_ORG_HANDLE = "candidate-e2e-org";
const LEGACY_STATIC_PROFILE_MEMBER_ID = "q972bnrgasvzypr43w37kvs9t98cqrpc";
const GENERATION_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,13}[a-z0-9])?$/;
const PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const pixelPng = new Uint8Array(
  Array.from(atob(PIXEL_PNG_BASE64), (character) => character.charCodeAt(0)),
);

type FixtureNames = Readonly<{
  generation: string;
  userHandle: string;
  profileSlug: string;
  profileAlias: string;
  orgHandle: string;
}>;

type FixtureStorage = Readonly<{
  profileImageStorageId: Id<"_storage">;
  profileImage: string;
  orgImageStorageId: Id<"_storage">;
  orgImage: string;
}>;

type FixtureCurrent = Readonly<{
  profileImageStorageId: Id<"_storage"> | null;
  orgImageStorageId: Id<"_storage"> | null;
}>;

type FixtureResult = FixtureNames;

type FixtureRemoval = Readonly<{ storageIds: Id<"_storage">[] }>;

function requireCandidateFixtureEnvironment() {
  if (process.env.CANDIDATE_E2E_FIXTURES !== "1") {
    throw new ConvexError("CANDIDATE_E2E_FIXTURES=1 is required");
  }
}

function requireConfirmation(confirmation: string) {
  if (confirmation !== FIXTURE_CONFIRMATION) {
    throw new ConvexError("Invalid candidate fixture confirmation");
  }
}

function fixtureNames(generation: string): FixtureNames {
  if (!GENERATION_PATTERN.test(generation)) {
    throw new ConvexError("Fixture generation must be 1-15 lowercase letters, digits, or hyphens");
  }
  return {
    generation,
    userHandle: `${FIXTURE_NAMESPACE}-user-${generation}`,
    profileSlug: `${FIXTURE_NAMESPACE}-profile-${generation}`,
    profileAlias: `${FIXTURE_NAMESPACE}-profile-${generation}-v1`,
    orgHandle: `${FIXTURE_NAMESPACE}-org-${generation}`,
  };
}

function assertFixtureMarker(value: string | undefined) {
  if (value !== FIXTURE_MARKER) {
    throw new ConvexError("Refusing to modify a non-fixture record");
  }
}

async function upsertFixtureUser(
  ctx: Parameters<typeof syncProfileIdentityAliases>[0],
  names: FixtureNames,
  storage: FixtureStorage,
) {
  const now = Date.now();
  const existing = await ctx.db
    .query("users")
    .withIndex("handle", (query) => query.eq("handle", names.userHandle))
    .unique();
  const userFields = {
    handle: names.userHandle,
    displayName: "Candidate E2E User",
    bio: FIXTURE_MARKER,
    image: storage.profileImage,
    imageStorageId: storage.profileImageStorageId,
    deletedAt: undefined,
    deactivatedAt: undefined,
    purgedAt: undefined,
    banReason: undefined,
    updatedAt: now,
  };
  const userId = existing
    ? (assertFixtureMarker(existing.bio),
      await ctx.db.patch(existing._id, userFields),
      existing._id)
    : await ctx.db.insert("users", {
        ...userFields,
        profileSlug: names.profileAlias,
        role: "user",
        createdAt: now,
      });

  // First establish the historical canonical slug, then promote the current slug so retirement is exercised.
  await syncProfileIdentityAliases(
    ctx,
    userId,
    { handle: names.userHandle, profileSlug: names.profileAlias },
    now,
  );
  await ctx.db.patch(userId, { profileSlug: names.profileSlug, updatedAt: now });
  await syncProfileIdentityAliases(
    ctx,
    userId,
    { handle: names.userHandle, profileSlug: names.profileSlug },
    now,
  );
  const user = await ctx.db.get(userId);
  if (!user) throw new ConvexError("Fixture user was not created");
  return user;
}

export const current = internalQuery({
  args: { generation: v.string() },
  handler: async (ctx, args): Promise<FixtureCurrent> => {
    const names = fixtureNames(args.generation);
    const [user, org] = await Promise.all([
      ctx.db
        .query("users")
        .withIndex("handle", (query) => query.eq("handle", names.userHandle))
        .unique(),
      ctx.db
        .query("publishers")
        .withIndex("by_handle", (query) => query.eq("handle", names.orgHandle))
        .unique(),
    ]);
    if (user) assertFixtureMarker(user.bio);
    if (org) assertFixtureMarker(org.bio);
    return {
      profileImageStorageId: user?.imageStorageId ?? null,
      orgImageStorageId: org?.imageStorageId ?? null,
    };
  },
});

export const upsert = internalMutation({
  args: {
    generation: v.string(),
    profileImageStorageId: v.id("_storage"),
    profileImage: v.string(),
    orgImageStorageId: v.id("_storage"),
    orgImage: v.string(),
  },
  handler: async (ctx, args): Promise<FixtureResult> => {
    const names = fixtureNames(args.generation);
    const storage: FixtureStorage = args;
    const user = await upsertFixtureUser(ctx, names, storage);
    const personalPublisher = await ensurePersonalPublisherForUser(ctx, user, {
      actorUserId: user._id,
      source: "candidate-e2e-fixture",
    });
    if (!personalPublisher) throw new ConvexError("Fixture personal Publisher was not created");
    if (personalPublisher.handle !== names.userHandle) {
      throw new ConvexError("Fixture personal Publisher handle does not match its Profile handle");
    }
    const now = Date.now();
    const existingOrg = await ctx.db
      .query("publishers")
      .withIndex("by_handle", (query) => query.eq("handle", names.orgHandle))
      .unique();
    const orgFields = {
      kind: "org" as const,
      handle: names.orgHandle,
      displayName: "Candidate E2E Official Organization",
      bio: FIXTURE_MARKER,
      image: storage.orgImage,
      imageStorageId: storage.orgImageStorageId,
      deletedAt: undefined,
      deactivatedAt: undefined,
      updatedAt: now,
    };
    const orgId = existingOrg
      ? (assertFixtureMarker(existingOrg.bio),
        await ctx.db.patch(existingOrg._id, orgFields),
        existingOrg._id)
      : await ctx.db.insert("publishers", { ...orgFields, createdAt: now });

    const member = await ctx.db
      .query("publisherMembers")
      .withIndex("by_publisher_user", (query) =>
        query.eq("publisherId", orgId).eq("userId", user._id),
      )
      .unique();
    if (member) {
      await ctx.db.patch(member._id, { role: "owner", updatedAt: now });
    } else {
      await ctx.db.insert("publisherMembers", {
        publisherId: orgId,
        userId: user._id,
        role: "owner",
        createdAt: now,
        updatedAt: now,
      });
    }

    const official = await ctx.db
      .query("officialPublishers")
      .withIndex("by_publisher", (query) => query.eq("publisherId", orgId))
      .unique();
    if (!official) {
      await ctx.db.insert("officialPublishers", {
        publisherId: orgId,
        reason: FIXTURE_MARKER,
        createdByUserId: user._id,
        createdAt: now,
        updatedAt: now,
      });
    }

    return names;
  },
});

export const remove = internalMutation({
  args: { generation: v.string() },
  handler: async (ctx, args): Promise<FixtureRemoval> => {
    const names = fixtureNames(args.generation);
    const org = await ctx.db
      .query("publishers")
      .withIndex("by_handle", (query) => query.eq("handle", names.orgHandle))
      .unique();
    const user = await ctx.db
      .query("users")
      .withIndex("handle", (query) => query.eq("handle", names.userHandle))
      .unique();
    const storageIds: Id<"_storage">[] = [];

    if (org) {
      assertFixtureMarker(org.bio);
      if (org.imageStorageId) storageIds.push(org.imageStorageId);
      const [members, officials] = await Promise.all([
        ctx.db
          .query("publisherMembers")
          .withIndex("by_publisher", (query) => query.eq("publisherId", org._id))
          .collect(),
        ctx.db
          .query("officialPublishers")
          .withIndex("by_publisher", (query) => query.eq("publisherId", org._id))
          .collect(),
      ]);
      await Promise.all([
        ...members.map((member) => ctx.db.delete(member._id)),
        ...officials.map((row) => ctx.db.delete(row._id)),
      ]);
      await ctx.db.delete(org._id);
    }

    if (user) {
      assertFixtureMarker(user.bio);
      if (user.imageStorageId) storageIds.push(user.imageStorageId);
      const [aliases, personalPublishers] = await Promise.all([
        ctx.db
          .query("profileIdentityAliases")
          .withIndex("by_user_and_alias_kind", (query) =>
            query.eq("userId", user._id).eq("aliasKind", "profile_slug"),
          )
          .collect(),
        ctx.db
          .query("publishers")
          .withIndex("by_linked_user", (query) => query.eq("linkedUserId", user._id))
          .collect(),
      ]);
      const handleAliases = await ctx.db
        .query("profileIdentityAliases")
        .withIndex("by_user_and_alias_kind", (query) =>
          query.eq("userId", user._id).eq("aliasKind", "user_handle"),
        )
        .collect();
      await Promise.all([
        ...aliases.map((alias) => ctx.db.delete(alias._id)),
        ...handleAliases.map((alias) => ctx.db.delete(alias._id)),
        ...personalPublishers.map((publisher) => ctx.db.delete(publisher._id)),
      ]);
      await ctx.db.delete(user._id);
    }
    return { storageIds };
  },
});

export const cleanupLegacyStaticProfile = internalMutation({
  args: { confirmation: v.string() },
  handler: async (ctx, args): Promise<FixtureRemoval> => {
    requireConfirmation(args.confirmation);
    const [user, staticPublisher] = await Promise.all([
      ctx.db
        .query("users")
        .withIndex("handle", (query) => query.eq("handle", LEGACY_STATIC_USER_HANDLE))
        .unique(),
      ctx.db
        .query("publishers")
        .withIndex("by_handle", (query) => query.eq("handle", LEGACY_STATIC_USER_HANDLE))
        .unique(),
    ]);
    if (user) assertFixtureMarker(user.bio);
    if (staticPublisher) assertFixtureMarker(staticPublisher.bio);

    const linkedPersonalPublishers = user
      ? await ctx.db
          .query("publishers")
          .withIndex("by_linked_user", (query) => query.eq("linkedUserId", user._id))
          .collect()
      : [];
    // The legacy static Publisher predates linkedUserId on some candidate data.
    // Include it explicitly so its member rows cannot survive the fixture cleanup.
    const personalPublishers = [
      ...new Map(
        [...linkedPersonalPublishers, ...(staticPublisher ? [staticPublisher] : [])].map((publisher) => [
          publisher._id,
          publisher,
        ]),
      ).values(),
    ];
    personalPublishers.forEach((publisher) => assertFixtureMarker(publisher.bio));
    const legacyStaticMemberId = ctx.db.normalizeId(
      "publisherMembers",
      LEGACY_STATIC_PROFILE_MEMBER_ID,
    );
    const legacyStaticMember = legacyStaticMemberId
      ? await ctx.db.get(legacyStaticMemberId)
      : null;
    const orphanedLegacyStaticMember =
      legacyStaticMember && !(await ctx.db.get(legacyStaticMember.publisherId))
        ? legacyStaticMember
        : null;

    const [slugAliases, handleAliases, publisherRelations] = await Promise.all([
      user
        ? ctx.db
            .query("profileIdentityAliases")
            .withIndex("by_user_and_alias_kind", (query) =>
              query.eq("userId", user._id).eq("aliasKind", "profile_slug"),
            )
            .collect()
        : [],
      user
        ? ctx.db
            .query("profileIdentityAliases")
            .withIndex("by_user_and_alias_kind", (query) =>
              query.eq("userId", user._id).eq("aliasKind", "user_handle"),
            )
            .collect()
        : [],
      Promise.all(
        personalPublishers.map(async (publisher) => {
          const [members, officials] = await Promise.all([
            ctx.db
              .query("publisherMembers")
              .withIndex("by_publisher", (query) => query.eq("publisherId", publisher._id))
              .collect(),
            ctx.db
              .query("officialPublishers")
              .withIndex("by_publisher", (query) => query.eq("publisherId", publisher._id))
              .collect(),
          ]);
          return { members, officials };
        }),
      ),
    ]);
    await Promise.all([
      ...slugAliases.map((alias) => ctx.db.delete(alias._id)),
      ...handleAliases.map((alias) => ctx.db.delete(alias._id)),
      ...publisherRelations.flatMap(({ members, officials }) => [
        ...members.map((member) => ctx.db.delete(member._id)),
        ...officials.map((official) => ctx.db.delete(official._id)),
      ]),
      ...(orphanedLegacyStaticMember ? [ctx.db.delete(orphanedLegacyStaticMember._id)] : []),
      ...personalPublishers.map((publisher) => ctx.db.delete(publisher._id)),
      ...(user ? [ctx.db.delete(user._id)] : []),
    ]);
    return { storageIds: user?.imageStorageId ? [user.imageStorageId] : [] };
  },
});

export const cleanupLegacyStatic = internalMutation({
  args: { confirmation: v.string() },
  handler: async (ctx, args): Promise<{ removed: number }> => {
    requireConfirmation(args.confirmation);
    const handles = [LEGACY_STATIC_USER_HANDLE, LEGACY_STATIC_ORG_HANDLE] as const;
    let removed = 0;
    for (const handle of handles) {
      const publisher = await ctx.db
        .query("publishers")
        .withIndex("by_handle", (query) => query.eq("handle", handle))
        .unique();
      if (!publisher) continue;
      assertFixtureMarker(publisher.bio);
      const [members, officials] = await Promise.all([
        ctx.db
          .query("publisherMembers")
          .withIndex("by_publisher", (query) => query.eq("publisherId", publisher._id))
          .collect(),
        ctx.db
          .query("officialPublishers")
          .withIndex("by_publisher", (query) => query.eq("publisherId", publisher._id))
          .collect(),
      ]);
      await Promise.all([
        ...members.map((member) => ctx.db.delete(member._id)),
        ...officials.map((official) => ctx.db.delete(official._id)),
      ]);
      await ctx.db.delete(publisher._id);
      removed += 1;
    }
    return { removed };
  },
});

export const cleanupLegacyStaticAction: ReturnType<typeof action> = action({
  args: { confirmation: v.string() },
  handler: async (ctx, args): Promise<{ removed: number }> => {
    requireCandidateFixtureEnvironment();
    requireConfirmation(args.confirmation);
    return (await ctx.runMutation(internal.candidateE2eFixtures.cleanupLegacyStatic, args)) as {
      removed: number;
    };
  },
});

export const cleanupLegacyStaticProfileAction: ReturnType<typeof action> = action({
  args: { confirmation: v.string() },
  handler: async (ctx, args): Promise<Readonly<{ removed: true; storageCount: number }>> => {
    requireCandidateFixtureEnvironment();
    requireConfirmation(args.confirmation);
    const { storageIds } = (await ctx.runMutation(
      internal.candidateE2eFixtures.cleanupLegacyStaticProfile,
      args,
    )) as FixtureRemoval;
    await Promise.all(storageIds.map((storageId) => ctx.storage.delete(storageId)));
    return { removed: true, storageCount: storageIds.length };
  },
});

export const seed: ReturnType<typeof action> = action({
  args: { confirmation: v.string(), generation: v.string() },
  handler: async (ctx, args): Promise<FixtureResult> => {
    requireCandidateFixtureEnvironment();
    requireConfirmation(args.confirmation);
    fixtureNames(args.generation);
    const current = (await ctx.runQuery(
      internal.candidateE2eFixtures.current,
      { generation: args.generation },
    )) as FixtureCurrent;
    const profileImageStorageId =
      current.profileImageStorageId ??
      (await ctx.storage.store(new Blob([pixelPng], { type: "image/png" })));
    const orgImageStorageId =
      current.orgImageStorageId ??
      (await ctx.storage.store(new Blob([pixelPng], { type: "image/png" })));
    const [profileImage, orgImage] = await Promise.all([
      ctx.storage.getUrl(profileImageStorageId),
      ctx.storage.getUrl(orgImageStorageId),
    ]);
    if (!profileImage || !orgImage)
      throw new ConvexError("Fixture avatar storage URL was not created");
    return (await ctx.runMutation(internal.candidateE2eFixtures.upsert, {
      generation: args.generation,
      profileImageStorageId,
      profileImage,
      orgImageStorageId,
      orgImage,
    })) as FixtureResult;
  },
});

export const cleanup: ReturnType<typeof action> = action({
  args: { confirmation: v.string(), generation: v.string() },
  handler: async (ctx, args): Promise<Readonly<{ removed: true; storageCount: number }>> => {
    requireCandidateFixtureEnvironment();
    requireConfirmation(args.confirmation);
    fixtureNames(args.generation);
    const { storageIds } = (await ctx.runMutation(
      internal.candidateE2eFixtures.remove,
      { generation: args.generation },
    )) as FixtureRemoval;
    await Promise.all(storageIds.map((storageId: Id<"_storage">) => ctx.storage.delete(storageId)));
    return { removed: true, storageCount: storageIds.length };
  },
});
