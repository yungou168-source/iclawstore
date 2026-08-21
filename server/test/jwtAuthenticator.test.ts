import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { usersRoutes } from '../src/routes/users.js';
import { jwtConfigFromEnvironment, sessionIdFromClaims, subjectFromClaims, tokenIdFromClaims } from '../src/services/jwtAuthenticator.js';

const user = {
  id: 'user-1',
  handle: 'alice',
  displayName: 'Alice',
  name: 'Alice Example',
  image: null,
  email: 'alice@example.test',
  bio: 'Hello',
  role: 'user',
  trustedPublisher: false,
  publishedSkills: 0,
  totalStars: 0,
  totalDownloads: 0,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  deactivatedAt: null,
  deletedAt: null,
};

const createApp = async (authenticated: boolean) => {
  const app = Fastify();
  app.decorate('prisma', {
    users: { findUnique: async () => user },
  } as never);
  app.decorateRequest('user', null);
  app.decorate('authenticate', async (request: { user: typeof user | null }) => {
    if (!authenticated) throw new Error('authentication required');
    request.user = { id: user.id } as typeof user;
  });
  app.setErrorHandler((error, _request, reply) => {
    reply.status(401).send({ code: 'AUTH_REQUIRED', error: error.message });
  });
  await app.register(usersRoutes, { prefix: '/api/users' });
  return app;
};

describe('independent JWT configuration', () => {
  it('requires issuer, audience, and JWKS URI', () => {
    expect(jwtConfigFromEnvironment({ AUTH_ISSUER: 'https://issuer.test' })).toBeNull();
    expect(
      jwtConfigFromEnvironment({
        AUTH_ISSUER: 'https://issuer.test/',
        AUTH_AUDIENCE: 'clawhub-api',
        AUTH_JWKS_URI: 'https://issuer.test/.well-known/jwks.json',
      }),
    ).toEqual({
      issuer: 'https://issuer.test',
      audience: 'clawhub-api',
      jwksUri: 'https://issuer.test/.well-known/jwks.json',
    });
  });

  it('requires a stable subject claim', () => {
    expect(subjectFromClaims({ sub: 'user-1' })).toBe('user-1');
    expect(() => subjectFromClaims({})).toThrow('stable subject');
    expect(sessionIdFromClaims({ sid: 'session-1' })).toBe('session-1');
    expect(() => sessionIdFromClaims({})).toThrow('session identifier');
    expect(tokenIdFromClaims({ jti: 'token-1' })).toBe('token-1');
    expect(tokenIdFromClaims({})).toBeUndefined();
    expect(() => tokenIdFromClaims({ jti: '' })).toThrow('token identifier');
  });
});

describe('GET /api/users/me', () => {
  it('returns the authenticated MySQL user', async () => {
    const app = await createApp(true);
    const response = await app.inject({ method: 'GET', url: '/api/users/me' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: 'user-1', email: 'alice@example.test' });
    await app.close();
  });

  it('rejects an unauthenticated request', async () => {
    const app = await createApp(false);
    const response = await app.inject({ method: 'GET', url: '/api/users/me' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'AUTH_REQUIRED' });
    await app.close();
  });
});