import { verifyAccessToken, type OAuthProvider } from '@codefox-inc/oauth-provider';
import { httpRouter } from 'convex/server';
import { components, internal } from './_generated/api';
import { httpAction, type ActionCtx } from './_generated/server';
import {
  createDesktopOAuthProvider,
  DESKTOP_OAUTH_AUDIENCE,
  DESKTOP_OAUTH_PREFIX,
} from './desktopOAuthConfig';
import { requiredEnvironment } from './lib/oauthEnvironment';

function noStoreResponse(status = 200): Response {
  return new Response(null, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
    },
  });
}

function oauthErrorResponse(error: string, description: string, status = 400): Response {
  return new Response(JSON.stringify({ error, error_description: description }), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      Pragma: 'no-cache',
    },
  });
}

async function revokeDesktopAuthorization(
  ctx: ActionCtx,
  oauthProvider: OAuthProvider,
  userId: string,
  clientId: string,
): Promise<void> {
  await oauthProvider.revokeAuthorization(ctx, userId, clientId);
  await ctx.runMutation(internal.desktopOAuth.revokeRefreshFamiliesForUserInternal, {
    userId,
    revokedAt: Date.now(),
  });
}

async function enforceRefreshFamilyBeforeToken(
  ctx: ActionCtx,
  form: FormData,
  oauthProvider: OAuthProvider,
): Promise<
  | { blocked: Response; familyId?: never; userId?: never; clientId?: never }
  | { blocked?: never; familyId?: string; userId?: string; clientId?: string }
> {
  if (form.get('grant_type') !== 'refresh_token') return {};
  const refreshToken = form.get('refresh_token');
  if (typeof refreshToken !== 'string' || !refreshToken) return {};

  const token = await ctx.runQuery(components.oauthProvider.queries.getRefreshToken, {
    refreshToken,
  });
  if (!token) return {};
  const configuredClientId = requiredEnvironment('AI_DIRECT_DESKTOP_OAUTH_CLIENT_ID', {
    parseAsUrl: false,
  });
  const familyId = token.refreshTokenFamilyId;
  if (
    token.clientId !== configuredClientId ||
    typeof familyId !== 'string' ||
    !familyId ||
    token.refreshTokenRotatedAt !== undefined
  ) {
    await revokeDesktopAuthorization(ctx, oauthProvider, token.userId, configuredClientId);
    return { blocked: oauthErrorResponse('invalid_grant', 'Invalid refresh token') };
  }

  const decision = await ctx.runQuery(internal.desktopOAuth.getRefreshFamilyAccessInternal, {
    familyId,
    userId: token.userId,
    clientId: configuredClientId,
  });
  if (!decision.active) {
    await revokeDesktopAuthorization(ctx, oauthProvider, token.userId, configuredClientId);
    return { blocked: oauthErrorResponse('invalid_grant', 'Refresh token family is not active') };
  }
  return { familyId, userId: token.userId, clientId: configuredClientId };
}

async function tokenWithFamilyPolicy(
  ctx: ActionCtx,
  request: Request,
  oauthProvider: OAuthProvider,
): Promise<Response> {
  if (request.method === 'OPTIONS') return oauthProvider.handlers.token(ctx, request);
  const form = await request.clone().formData();
  const before = await enforceRefreshFamilyBeforeToken(ctx, form, oauthProvider);
  if (before.blocked) return before.blocked;

  const response = await oauthProvider.handlers.token(ctx, request);
  const payload = await response
    .clone()
    .json()
    .catch(() => null) as { error?: string; refresh_token?: string } | null;

  if (!response.ok) {
    if (payload?.error === 'invalid_grant' && before.userId && before.clientId) {
      await revokeDesktopAuthorization(ctx, oauthProvider, before.userId, before.clientId);
    }
    return response;
  }
  if (!payload?.refresh_token) return response;

  const issuedToken = await ctx.runQuery(components.oauthProvider.queries.getRefreshToken, {
    refreshToken: payload.refresh_token,
  });
  const configuredClientId = requiredEnvironment('AI_DIRECT_DESKTOP_OAUTH_CLIENT_ID', {
    parseAsUrl: false,
  });
  const familyId = issuedToken?.refreshTokenFamilyId;
  if (
    !issuedToken ||
    issuedToken.clientId !== configuredClientId ||
    typeof familyId !== 'string' ||
    !familyId
  ) {
    if (issuedToken?.userId) {
      await revokeDesktopAuthorization(ctx, oauthProvider, issuedToken.userId, configuredClientId);
    }
    return oauthErrorResponse('server_error', 'Unable to establish refresh token policy', 500);
  }

  try {
    await ctx.runMutation(internal.desktopOAuth.recordRefreshFamilyUseInternal, {
      familyId,
      userId: issuedToken.userId,
      clientId: configuredClientId,
      initialIssue: form.get('grant_type') === 'authorization_code',
    });
  } catch {
    await revokeDesktopAuthorization(ctx, oauthProvider, issuedToken.userId, configuredClientId);
    return oauthErrorResponse('server_error', 'Unable to establish refresh token policy', 500);
  }
  return response;
}

async function revokeToken(
  ctx: ActionCtx,
  request: Request,
  oauthProvider: OAuthProvider,
): Promise<Response> {
  if (request.method === 'OPTIONS') return noStoreResponse(204);

  try {
    const form = await request.formData();
    const token = form.get('token');
    const clientId = form.get('client_id');
    const configuredClientId = requiredEnvironment('AI_DIRECT_DESKTOP_OAUTH_CLIENT_ID', {
      parseAsUrl: false,
    });
    if (typeof token !== 'string' || typeof clientId !== 'string' || clientId !== configuredClientId) {
      return noStoreResponse();
    }

    const refreshToken = await ctx.runQuery(components.oauthProvider.queries.getRefreshToken, {
      refreshToken: token,
    });
    if (refreshToken?.clientId === configuredClientId) {
      await revokeDesktopAuthorization(ctx, oauthProvider, refreshToken.userId, configuredClientId);
      return noStoreResponse();
    }

    const config = oauthProvider.getConfig();
    const issuer = `${requiredEnvironment('CUSTOM_AUTH_SITE_URL')}${DESKTOP_OAUTH_PREFIX}`;
    const payload = await verifyAccessToken(token, config, issuer, DESKTOP_OAUTH_AUDIENCE);
    const tokenClientId =
      typeof payload.client_id === 'string'
        ? payload.client_id
        : typeof payload.cid === 'string'
          ? payload.cid
          : null;
    const userId = typeof payload.sub === 'string' ? payload.sub : null;
    if (tokenClientId === configuredClientId && userId) {
      await revokeDesktopAuthorization(ctx, oauthProvider, userId, configuredClientId);
    }
  } catch {
    // RFC 7009 requires a successful response even when the token is unknown.
  }
  return noStoreResponse();
}

export function registerDesktopOAuthRoutes(http: ReturnType<typeof httpRouter>): void {
  const oauthProvider = createDesktopOAuthProvider();

  const getUserProfile = (ctx: ActionCtx, userId: string) =>
    ctx.runQuery(internal.desktopOAuth.getUserProfileInternal, { userId });
  const getRoutes = [
    [`${DESKTOP_OAUTH_PREFIX}/.well-known/openid-configuration`, oauthProvider.handlers.openIdConfiguration],
    [`${DESKTOP_OAUTH_PREFIX}/.well-known/oauth-authorization-server`, oauthProvider.handlers.openIdConfiguration],
    [`${DESKTOP_OAUTH_PREFIX}/.well-known/jwks.json`, oauthProvider.handlers.jwks],
    [`${DESKTOP_OAUTH_PREFIX}/.well-known/oauth-protected-resource`, oauthProvider.handlers.protectedResource],
    [`${DESKTOP_OAUTH_PREFIX}/authorize`, oauthProvider.handlers.authorize],
  ] as const;
  for (const [path, handler] of getRoutes) {
    for (const method of ['GET', 'OPTIONS'] as const) {
      http.route({ path, method, handler: httpAction((ctx, request) => handler(ctx, request)) });
    }
  }

  for (const method of ['POST', 'OPTIONS'] as const) {
    http.route({
      path: `${DESKTOP_OAUTH_PREFIX}/token`,
      method,
      handler: httpAction((ctx, request) => tokenWithFamilyPolicy(ctx, request, oauthProvider)),
    });
  }

  for (const method of ['GET', 'POST', 'OPTIONS'] as const) {
    http.route({
      path: `${DESKTOP_OAUTH_PREFIX}/userinfo`,
      method,
      handler: httpAction((ctx, request) =>
        oauthProvider.handlers.userInfo(ctx, request, (userId) => getUserProfile(ctx, userId)),
      ),
    });
  }

  for (const method of ['POST', 'OPTIONS'] as const) {
    http.route({
      path: `${DESKTOP_OAUTH_PREFIX}/revoke`,
      method,
      handler: httpAction((ctx, request) => revokeToken(ctx, request, oauthProvider)),
    });
  }
}