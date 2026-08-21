import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createAuthorizationUrl, type OAuthProviderConfig } from '../services/oauthProvider.js';
import { createOAuthTransaction, type OAuthTransactionStore } from '../services/oauthTransaction.js';
import { createSessionEstablishmentService, type AuthorizationCodeExchange, type SessionEstablishmentPort } from '../services/sessionEstablishment.js';
import { rotateRefreshToken, type RefreshRotationResult, type RefreshTokenStore } from '../services/refreshTokenFamily.js';

export type AuthRouteDeps = Readonly<{
  transactions: OAuthTransactionStore;
  exchange: AuthorizationCodeExchange;
  sessions: SessionEstablishmentPort & { revokeAllForUser(userId: string, at?: Date): Promise<void> };
  refreshTokens: RefreshTokenStore;
  provider: Readonly<{
    authorization: OAuthProviderConfig;
  }>;
  issueAccessToken(input: Readonly<{ userId: string; sessionId: string }>): Promise<Readonly<{ accessToken: string; expiresIn: number }>>;
  now?: () => Date;
  transactionTtlMs?: number;
  refreshTtlMs: number;
}>;

type CallbackParams = {
  transactionId?: string;
  transaction_id?: string;
  code?: string;
  state?: string;
  nonce?: string;
  codeVerifier?: string;
  code_verifier?: string;
};

type ErrorKind = 'invalid_request' | 'provider_error' | 'state_reuse' | 'refresh_reuse' | 'auth_error';

const errorResponse = (reply: FastifyReply, statusCode: number, kind: ErrorKind): FastifyReply =>
  reply.status(statusCode).send({ error: kind });

const stringValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

const readCookie = (request: FastifyRequest, name: string): string | undefined => {
  const header = request.headers.cookie;
  const value = header?.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return value ? decodeURIComponent(value.slice(name.length + 1)) : undefined;
};

const authCookie = (name: string, value: string, maxAgeSeconds: number): string =>
  `${name}=${encodeURIComponent(value)}; Path=/auth; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;

const clearAuthCookie = (name: string): string =>
  `${name}=; Path=/auth; Max-Age=0; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;

const callbackInput = (request: FastifyRequest): CallbackParams => ({
  ...((request.query ?? {}) as CallbackParams),
  ...((request.body ?? {}) as CallbackParams),
});

const mapError = (error: unknown): { status: number; kind: ErrorKind } => {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('already consumed') || message.includes('state mismatch')) return { status: 409, kind: 'state_reuse' };
  if (message.includes('provider') || message.includes('OAuth')) return { status: 502, kind: 'provider_error' };
  return { status: 400, kind: 'invalid_request' };
};

export const createAuthRoutes = (deps: AuthRouteDeps) => async (fastify: FastifyInstance): Promise<void> => {
  const now = deps.now ?? (() => new Date());
  const ttlMs = deps.transactionTtlMs ?? 10 * 60 * 1000;
  const sessions = createSessionEstablishmentService(deps.transactions, deps.exchange, deps.sessions);

  fastify.get('/auth/start', async (_request, reply) => {
    const transaction = await createOAuthTransaction(deps.transactions, {
      redirectUri: deps.provider.authorization.redirectUri,
      clientId: deps.provider.authorization.clientId,
      expiresAt: new Date(now().getTime() + ttlMs),
    });
    reply.header('set-cookie', [
      authCookie('candidate_oauth_tx', transaction.transactionId, Math.ceil(ttlMs / 1000)),
      authCookie('candidate_oauth_nonce', transaction.nonce, Math.ceil(ttlMs / 1000)),
      authCookie('candidate_oauth_verifier', transaction.codeVerifier, Math.ceil(ttlMs / 1000)),
    ]);
    return reply.redirect(createAuthorizationUrl(deps.provider.authorization, transaction));
  });

  const callback = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = callbackInput(request);
    const transactionId = stringValue(params.transactionId ?? params.transaction_id) ?? readCookie(request, 'candidate_oauth_tx');
    const code = stringValue(params.code);
    const state = stringValue(params.state);
    const nonce = readCookie(request, 'candidate_oauth_nonce');
    const codeVerifier = readCookie(request, 'candidate_oauth_verifier');
    if (!transactionId || !code || !state || !nonce || !codeVerifier) return errorResponse(reply, 400, 'invalid_request');
    try {
      const result = await sessions.establish({ transactionId, code, state, nonce, codeVerifier }, now());
      const token = await deps.issueAccessToken({ userId: result.userId, sessionId: result.sessionId });
      reply.header('set-cookie', [
        clearAuthCookie('candidate_oauth_tx'),
        clearAuthCookie('candidate_oauth_nonce'),
        clearAuthCookie('candidate_oauth_verifier'),
      ]);
      return reply.status(200).send({ ...result, ...token });
    } catch (error) {
      const mapped = mapError(error);
      return errorResponse(reply, mapped.status, mapped.kind);
    }
  };
  fastify.get('/auth/callback', callback);
  fastify.post('/auth/callback', callback);

  fastify.post('/auth/refresh', async (request, reply) => {
    const body = (request.body ?? {}) as { refreshToken?: string; refresh_token?: string };
    const presented = stringValue(body.refreshToken ?? body.refresh_token);
    if (!presented) return errorResponse(reply, 400, 'invalid_request');
    let result: RefreshRotationResult;
    try {
      result = await rotateRefreshToken(deps.refreshTokens, presented, { now: now(), ttlMs: deps.refreshTtlMs });
    } catch {
      return errorResponse(reply, 503, 'auth_error');
    }
    if (result.kind !== 'rotated') {
      return errorResponse(reply, result.kind === 'reuse-detected' ? 401 : 401, result.kind === 'reuse-detected' ? 'refresh_reuse' : 'auth_error');
    }
    const token = await deps.issueAccessToken({ userId: result.userId, sessionId: result.sessionId });
    return reply.send({ ...token, refreshToken: result.refreshToken });
  });

  fastify.post('/auth/logout-all', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) return errorResponse(reply, 401, 'auth_error');
    await deps.refreshTokens.revokeAllForUser(userId, now());
    await deps.sessions.revokeAllForUser(userId, now());
    return reply.status(204).send();
  });
};