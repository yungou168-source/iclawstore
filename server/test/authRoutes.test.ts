import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'bun:test';
import { createAuthRoutes } from '../src/routes/auth.js';
import type { OAuthTransaction, OAuthTransactionStore } from '../src/services/oauthTransaction.js';
import { hashRefreshToken, type RefreshTokenRecord, type RefreshTokenStore } from '../src/services/refreshTokenFamily.js';
import type { OAuthProviderConfig } from '../src/services/oauthProvider.js';

const apps: FastifyInstance[] = [];
const provider: OAuthProviderConfig = {
  issuer: 'https://candidate-issuer.test', clientId: 'candidate', clientSecret: 'secret',
  authorizationEndpoint: 'https://candidate-issuer.test/authorize', tokenEndpoint: 'https://candidate-issuer.test/token',
  jwksUri: 'https://candidate-issuer.test/jwks', audience: 'candidate-api',
  redirectUri: 'https://candidate.test/auth/callback', scopes: ['openid', 'profile', 'email'],
};

const createStores = () => {
  const transactions = new Map<string, OAuthTransaction>();
  const refreshRows: RefreshTokenRecord[] = [];
  const revokedUsers: string[] = [];
  const transactionStore: OAuthTransactionStore = {
    async insert(row) { transactions.set(row.id, row); },
    async find(id) { return transactions.get(id) ?? null; },
    async consume(id, at) {
      const row = transactions.get(id);
      if (!row || row.consumedAt) return null;
      row.consumedAt = at;
      return row;
    },
    async saveCallbackResult(id, result) {
      const row = transactions.get(id);
      if (!row) throw new Error('missing transaction');
      row.callbackResult = result;
    },
  };
  const refresh: RefreshTokenStore = {
    async findByHash(hash) { return refreshRows.find((row) => row.tokenHash === hash) ?? null; },
    async insert(row) { refreshRows.push(row); },
    async markUsed(hash, at) {
      const row = refreshRows.find((item) => item.tokenHash === hash);
      if (!row || row.usedAt) return false;
      row.usedAt = at;
      return true;
    },
    async revokeFamily(familyId, at) { refreshRows.filter((row) => row.familyId === familyId).forEach((row) => { row.revokedAt = at; }); },
    async revokeAllForUser(userId, at) { revokedUsers.push(userId); refreshRows.filter((row) => row.userId === userId).forEach((row) => { row.revokedAt = at; }); },
  };
  return { transactions, transactionStore, refresh, refreshRows, revokedUsers };
};

const createApp = async (exchangeError = false) => {
  const stores = createStores();
  const sessionUsers: string[] = [];
  const app = Fastify({ logger: false });
  app.decorateRequest('user', null);
  app.decorate('authenticate', async (request: { user?: { id: string } }) => { request.user = { id: 'user-1' }; });
  await app.register(createAuthRoutes({
    transactions: stores.transactionStore,
    exchange: {
      async exchange(input) {
        if (exchangeError) throw new Error('OAuth provider unavailable');
        return { userId: 'user-1', issuer: provider.issuer, subject: 'subject-1', expiresAt: new Date('2099-01-01') };
      },
    },
    sessions: {
      async create(input) { sessionUsers.push(input.userId); return { sessionId: 'session-1' }; },
      async revokeAllForUser() { return undefined; },
    },
    refreshTokens: stores.refresh,
    provider: { authorization: provider },
    async issueAccessToken() { return { accessToken: 'access', expiresIn: 900 }; },
    now: () => new Date('2028-01-01T00:00:00Z'),
    refreshTtlMs: 3_600_000,
  }));
  await app.ready();
  apps.push(app);
  return { app, stores, sessionUsers };
};

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('candidate auth HTTP routes', () => {
  it('starts an authorization transaction and establishes a callback idempotently under concurrency', async () => {
    const { app, stores, sessionUsers } = await createApp();
    const start = await app.inject({ method: 'GET', url: '/auth/start' });
    expect(start.statusCode).toBe(302);
    const location = new URL(start.headers.location!);
    const transactionId = location.searchParams.get('transaction_id')!;
    const cookieHeader = (Array.isArray(start.headers['set-cookie']) ? start.headers['set-cookie'] : [start.headers['set-cookie']])
      .filter((value): value is string => Boolean(value))
      .map((value) => value.split(';')[0])
      .join('; ');
    const params = { transactionId, code: 'code-1', state: location.searchParams.get('state')! };
    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: '/auth/callback', headers: { cookie: cookieHeader }, payload: params }),
      app.inject({ method: 'POST', url: '/auth/callback', headers: { cookie: cookieHeader }, payload: params }),
    ]);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(sessionUsers).toEqual(['user-1']);
  });

  it('maps provider errors without exposing internals', async () => {
    const { app } = await createApp(true);
    const start = await app.inject({ method: 'GET', url: '/auth/start' });
    const location = new URL(start.headers.location!);
    const cookieHeader = (Array.isArray(start.headers['set-cookie']) ? start.headers['set-cookie'] : [start.headers['set-cookie']])
      .filter((value): value is string => Boolean(value))
      .map((value) => value.split(';')[0])
      .join('; ');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/callback',
      headers: { cookie: cookieHeader },
      payload: {
        transactionId: location.searchParams.get('transaction_id'),
        code: 'code-1',
        state: location.searchParams.get('state'),
      },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'provider_error' });
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const { app, stores } = await createApp();
    stores.refreshRows.push({ tokenHash: hashRefreshToken('refresh-1'), familyId: 'family-1', sessionId: 'session-1', userId: 'user-1', issuedAt: new Date('2026-01-01'), expiresAt: new Date('2099-01-01') });
    const first = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: 'refresh-1' } });
    expect(first.statusCode).toBe(200);
    const reused = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: 'refresh-1' } });
    expect(reused.statusCode).toBe(401);
    expect(reused.json()).toEqual({ error: 'refresh_reuse' });
  });

  it('requires authenticated user identity for logout-all', async () => {
    const { app, stores } = await createApp();
    const response = await app.inject({ method: 'POST', url: '/auth/logout-all' });
    expect(response.statusCode).toBe(204);
    expect(stores.revokedUsers).toEqual(['user-1']);
  });
});