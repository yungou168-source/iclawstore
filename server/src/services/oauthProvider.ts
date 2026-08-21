import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export type OAuthProviderConfig = Readonly<{
  issuer: string;
  clientId: string;
  clientSecret?: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  audience: string;
  redirectUri: string;
  scopes: readonly string[];
}>;

export type OAuthProviderMetadata = Readonly<{
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}>;

const required = (env: NodeJS.ProcessEnv, key: string): string | null => {
  const value = env[key]?.trim();
  return value ? value : null;
};

const normalizeUrl = (value: string, field: string): string => {
  const url = new URL(value);
  if (url.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
    throw new Error(`${field} must use HTTPS in production`);
  }
  return url.toString().replace(/\/$/, '');
};

export const oauthProviderConfigFromEnvironment = (
  env: NodeJS.ProcessEnv = process.env,
): OAuthProviderConfig | null => {
  const issuer = required(env, 'AUTH_ISSUER');
  const clientId = required(env, 'AUTH_CLIENT_ID');
  const authorizationEndpoint = required(env, 'AUTH_AUTHORIZATION_ENDPOINT');
  const tokenEndpoint = required(env, 'AUTH_TOKEN_ENDPOINT');
  const jwksUri = required(env, 'AUTH_JWKS_URI');
  const audience = required(env, 'AUTH_AUDIENCE');
  const redirectUri = required(env, 'AUTH_REDIRECT_URI');
  if (!issuer || !clientId || !authorizationEndpoint || !tokenEndpoint || !jwksUri || !audience || !redirectUri) {
    return null;
  }
  return {
    issuer: normalizeUrl(issuer, 'AUTH_ISSUER'),
    clientId,
    clientSecret: required(env, 'AUTH_CLIENT_SECRET') ?? undefined,
    authorizationEndpoint: normalizeUrl(authorizationEndpoint, 'AUTH_AUTHORIZATION_ENDPOINT'),
    tokenEndpoint: normalizeUrl(tokenEndpoint, 'AUTH_TOKEN_ENDPOINT'),
    jwksUri: normalizeUrl(jwksUri, 'AUTH_JWKS_URI'),
    audience,
    redirectUri: normalizeUrl(redirectUri, 'AUTH_REDIRECT_URI'),
    scopes: (required(env, 'AUTH_SCOPES') ?? 'openid profile email').split(/\s+/),
  };
};

export const createAuthorizationUrl = (
  config: OAuthProviderConfig,
  transaction: Readonly<{ state: string; nonce: string; codeVerifier: string; transactionId: string }>,
): string => {
  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', config.scopes.join(' '));
  url.searchParams.set('state', transaction.state);
  url.searchParams.set('nonce', transaction.nonce);
  url.searchParams.set('code_challenge', base64UrlSha256(transaction.codeVerifier));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('transaction_id', transaction.transactionId);
  return url.toString();
};

const base64UrlSha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('base64url');

export type AuthorizationCodeExchangePort = {
  exchangeCode(input: Readonly<{ code: string; codeVerifier: string; redirectUri: string }>): Promise<Readonly<{
    accessToken: string;
    idToken?: string;
    expiresIn?: number;
  }>>;
  verifyIdentity(input: Readonly<{ idToken?: string; accessToken: string; nonce: string }>): Promise<Readonly<{
    issuer: string;
    subject: string;
    email?: string;
    emailVerified?: boolean;
    displayName?: string;
  }>>;
};

export const createFetchAuthorizationCodeExchange = (
  config: OAuthProviderConfig,
  fetchImpl: typeof fetch = fetch,
): AuthorizationCodeExchangePort => {
  const jwks = createRemoteJWKSet(new URL(config.jwksUri), { timeoutDuration: 5_000, cooldownDuration: 30_000 });
  return {
    async exchangeCode(input) {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        client_id: config.clientId,
        redirect_uri: input.redirectUri,
        code_verifier: input.codeVerifier,
      });
      if (config.clientSecret) body.set('client_secret', config.clientSecret);
      const response = await fetchImpl(config.tokenEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body,
      });
      if (!response.ok) throw new Error(`OAuth token exchange failed: ${response.status}`);
      const result = (await response.json()) as { access_token?: string; id_token?: string; expires_in?: number };
      if (!result.access_token) throw new Error('OAuth provider returned no access token');
      return { accessToken: result.access_token, idToken: result.id_token, expiresIn: result.expires_in };
    },
    async verifyIdentity(input) {
      if (!input.idToken) throw new Error('OAuth provider returned no ID token');
      const { payload } = await jwtVerify(input.idToken, jwks, {
        issuer: config.issuer,
        audience: config.clientId,
        algorithms: ['RS256'],
        clockTolerance: 5,
      });
      if (payload.nonce !== input.nonce) throw new Error('OAuth ID token nonce mismatch');
      if (typeof payload.sub !== 'string' || !payload.sub.trim()) throw new Error('OAuth ID token has no subject');
      return {
        issuer: config.issuer,
        subject: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        emailVerified: payload.email_verified === true,
        displayName: typeof payload.name === 'string' ? payload.name : undefined,
      };
    },
  };
};