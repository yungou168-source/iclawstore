import { OAuthProvider } from '@codefox-inc/oauth-provider';
import { getAuthUserId } from '@convex-dev/auth/server';
import { api, components } from './_generated/api';
import type { ActionCtx } from './_generated/server';
import { requiredEnvironment } from './lib/oauthEnvironment';

export const DESKTOP_OAUTH_AUDIENCE = 'https://www.iclawstore.com/api/v1/ai-direct-hiring';
export const DESKTOP_OAUTH_PREFIX = '/oauth/desktop';
export const DESKTOP_OAUTH_CLIENT_NAME = 'AI Direct Hiring Desktop';
export const DESKTOP_OAUTH_SCOPES = ['openid', 'profile', 'email', 'offline_access'] as const;

export function createDesktopOAuthProvider() {
  return new OAuthProvider(components.oauthProvider, {
    privateKey: requiredEnvironment('JWT_PRIVATE_KEY', { parseAsUrl: false }),
    jwks: requiredEnvironment('JWKS', { parseAsUrl: false }),
    siteUrl: requiredEnvironment('SITE_URL'),
    convexSiteUrl: requiredEnvironment('CUSTOM_AUTH_SITE_URL'),
    prefix: DESKTOP_OAUTH_PREFIX,
    applicationID: DESKTOP_OAUTH_AUDIENCE,
    allowedScopes: [...DESKTOP_OAUTH_SCOPES],
    allowDynamicClientRegistration: false,
    getUserId: async (ctx: ActionCtx) => {
      const userId = await getAuthUserId(ctx);
      if (!userId) return null;
      const user = await ctx.runQuery(api.users.me, {});
      return user?._id ?? null;
    },
  });
}