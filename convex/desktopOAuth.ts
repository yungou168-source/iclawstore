import { getOAuthClientId, isOAuthToken } from '@codefox-inc/oauth-provider';
import { v } from 'convex/values';
import { components, internal } from './_generated/api';
import { internalQuery } from './_generated/server';
import { internalMutation, mutation, query } from './functions';
import { DESKTOP_OAUTH_CLIENT_NAME, DESKTOP_OAUTH_SCOPES } from './desktopOAuthConfig';
import { assertAdmin, requireUser } from './lib/access';
import {
  createDesktopTokenFamilyPolicy,
  evaluateDesktopTokenFamily,
  touchDesktopTokenFamily,
} from './lib/desktopOAuthTokenPolicy';
import { desktopOAuthRedirectUris, requiredEnvironment } from './lib/oauthEnvironment';

function configuredClientId(): string {
  return requiredEnvironment('AI_DIRECT_DESKTOP_OAUTH_CLIENT_ID', { parseAsUrl: false });
}

function sameStrings(left: string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

export const ensureDesktopClient = mutation({
  args: {},
  returns: v.object({ clientId: v.string(), created: v.boolean() }),
  handler: async (ctx) => {
    const { user } = await requireUser(ctx);
    assertAdmin(user);

    const redirectUris = desktopOAuthRedirectUris();
    const expectedClientId = process.env.AI_DIRECT_DESKTOP_OAUTH_CLIENT_ID?.trim();
    const clients = await ctx.runQuery(components.oauthProvider.queries.listClients, {});
    const matches = clients.filter((client) =>
      expectedClientId ? client.clientId === expectedClientId : client.name === DESKTOP_OAUTH_CLIENT_NAME,
    );
    if (matches.length > 1) throw new Error('Multiple desktop OAuth clients are registered');

    const existing = matches[0];
    if (existing) {
      if (
        existing.type !== 'public' ||
        existing.tokenEndpointAuthMethod !== 'none' ||
        !sameStrings(existing.redirectUris, redirectUris) ||
        !sameStrings(existing.allowedScopes, DESKTOP_OAUTH_SCOPES)
      ) {
        throw new Error('Desktop OAuth client registration does not match the locked configuration');
      }
      return { clientId: existing.clientId, created: false };
    }
    if (expectedClientId) {
      throw new Error('Configured AI_DIRECT_DESKTOP_OAUTH_CLIENT_ID is not registered');
    }

    const result = await ctx.runMutation(
      components.oauthProvider.clientManagement.registerClient,
      {
        name: DESKTOP_OAUTH_CLIENT_NAME,
        redirectUris,
        scopes: [...DESKTOP_OAUTH_SCOPES],
        type: 'public' as const,
        tokenEndpointAuthMethod: 'none' as const,
        isInternal: true,
      },
    );
    return { clientId: result.clientId, created: true };
  },
});

export const revokeMyDesktopAuthorization = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx);
    await ctx.runMutation(components.oauthProvider.mutations.revokeAuthorization, {
      userId,
      clientId: configuredClientId(),
    });
    return null;
  },
});

export const getRefreshFamilyAccessInternal = internalQuery({
  args: {
    familyId: v.string(),
    userId: v.string(),
    clientId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.db.normalizeId('users', args.userId);
    if (!userId || args.clientId !== configuredClientId()) {
      return { active: false as const, reason: 'identity_mismatch' as const };
    }
    const user = await ctx.db.get(userId);
    if (!user || user.deletedAt || user.deactivatedAt) {
      return { active: false as const, reason: 'account_disabled' as const };
    }
    const family = await ctx.db
      .query('desktopOAuthTokenFamilies')
      .withIndex('by_family_id', (q) => q.eq('familyId', args.familyId))
      .unique();
    if (!family || family.userId !== userId || family.clientId !== args.clientId) {
      return { active: false as const, reason: 'family_missing' as const };
    }
    return evaluateDesktopTokenFamily(family, Date.now());
  },
});

export const recordRefreshFamilyUseInternal = internalMutation({
  args: {
    familyId: v.string(),
    userId: v.string(),
    clientId: v.string(),
    initialIssue: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.db.normalizeId('users', args.userId);
    if (!userId || args.clientId !== configuredClientId()) {
      throw new Error('Desktop OAuth token family identity mismatch');
    }
    const user = await ctx.db.get(userId);
    if (!user || user.deletedAt || user.deactivatedAt) {
      throw new Error('Desktop OAuth token family user is disabled');
    }

    const now = Date.now();
    const existing = await ctx.db
      .query('desktopOAuthTokenFamilies')
      .withIndex('by_family_id', (q) => q.eq('familyId', args.familyId))
      .unique();
    if (existing) {
      if (existing.userId !== userId || existing.clientId !== args.clientId) {
        throw new Error('Desktop OAuth token family ownership conflict');
      }
      const decision = evaluateDesktopTokenFamily(existing, now);
      if (!decision.active) throw new Error(`Desktop OAuth token family ${decision.reason}`);
      await ctx.db.patch(existing._id, touchDesktopTokenFamily(existing, now));
      return null;
    }
    if (!args.initialIssue) throw new Error('Desktop OAuth token family is not registered');

    await ctx.db.insert('desktopOAuthTokenFamilies', {
      familyId: args.familyId,
      userId,
      clientId: args.clientId,
      ...createDesktopTokenFamilyPolicy(now),
    });
    return null;
  },
});

export const revokeRefreshFamiliesForUserInternal = internalMutation({
  args: {
    userId: v.string(),
    revokedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.db.normalizeId('users', args.userId);
    const clientId = process.env.AI_DIRECT_DESKTOP_OAUTH_CLIENT_ID?.trim();
    if (!userId || !clientId) return { revoked: 0, hasMore: false };

    const rows = await ctx.db
      .query('desktopOAuthTokenFamilies')
      .withIndex('by_user_and_client_and_revoked_at', (q) =>
        q.eq('userId', userId).eq('clientId', clientId).eq('revokedAt', undefined),
      )
      .take(100);
    const revokedAt = args.revokedAt ?? Date.now();
    for (const row of rows) await ctx.db.patch(row._id, { revokedAt });
    if (rows.length === 100) {
      await ctx.scheduler.runAfter(0, internal.desktopOAuth.revokeRefreshFamiliesForUserInternal, {
        userId,
        revokedAt,
      });
    }
    return { revoked: rows.length, hasMore: rows.length === 100 };
  },
});

export const getUserProfileInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const userId = ctx.db.normalizeId('users', args.userId);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user || user.deletedAt || user.deactivatedAt) return null;
    return {
      sub: user._id,
      name: user.displayName ?? user.name,
      email: user.email,
      picture: user.image,
    };
  },
});

export const getDesktopAccessIdentity = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || !isOAuthToken(identity)) return null;

    const clientId = getOAuthClientId(identity);
    if (!clientId || clientId !== configuredClientId()) return null;
    const userId = ctx.db.normalizeId('users', identity.subject);
    if (!userId) return null;

    const authorization = await ctx.runQuery(components.oauthProvider.queries.getAuthorization, {
      userId,
      clientId,
    });
    if (!authorization) return null;

    const user = await ctx.db.get(userId);
    if (!user || user.deletedAt || user.deactivatedAt) return null;
    return user;
  },
});