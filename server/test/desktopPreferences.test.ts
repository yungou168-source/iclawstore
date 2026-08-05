import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { createDesktopPreferencesRoutes } from '../src/routes/desktopPreferences.js';
import { AiDirectHiringError, errorResponse } from '../src/services/aiDirectErrors.js';
import { ManagedAssetStore } from '../src/services/managedAssetStore.js';

type Preference = { config: unknown; revision: bigint; updatedAt: Date };
type Asset = { id: string; userId: string; deletedAt: Date | null };

const apps: FastifyInstance[] = [];
const roots: string[] = [];

class FakeMysql {
  preferences = new Map<string, Preference>();
  assets = new Map<string, Asset>();
  templates = new Set<string>();

  async query(sql: string, params: unknown[] = []): Promise<[unknown[], unknown]> {
    if (sql.includes('FROM desktop_sidebar_preferences')) {
      const preference = this.preferences.get(String(params[0]));
      return [preference ? [{ ...preference }] : [], {}];
    }
    if (sql.includes('FROM desktop_sidebar_assets')) {
      const [id, userId] = params.map(String);
      const asset = this.assets.get(id);
      return [asset && asset.userId === userId && !asset.deletedAt ? [asset] : [], {}];
    }
    throw new Error(`Unexpected pool query: ${sql}`);
  }

  async getConnection() {
    return new FakeConnection(this);
  }
}

class FakeConnection {
  constructor(private readonly mysql: FakeMysql) {}
  async beginTransaction() {}
  async commit() {}
  async rollback() {}
  release() {}

  async query(sql: string, params: unknown[] = []): Promise<[unknown[], unknown]> {
    if (sql.startsWith('DELETE FROM desktop_sidebar_preferences')) {
      this.mysql.preferences.delete(String(params[0]));
      return [[], {}];
    }
    if (sql.includes('FROM desktop_sidebar_preferences')) {
      const preference = this.mysql.preferences.get(String(params[0]));
      return [preference ? [{ ...preference }] : [], {}];
    }
    if (sql.startsWith('INSERT INTO desktop_sidebar_preferences')) {
      const [userId, config, revision] = params.map(String);
      this.mysql.preferences.set(userId, {
        config: JSON.parse(config),
        revision: BigInt(revision),
        updatedAt: new Date(),
      });
      return [[], {}];
    }
    if (sql.includes('SELECT id FROM desktop_sidebar_assets')) {
      const userId = String(params[0]);
      const requested = params.slice(1).map(String);
      return [[...this.mysql.assets.values()].filter(
        (asset) => asset.userId === userId && !asset.deletedAt && requested.includes(asset.id),
      ), {}];
    }
    if (sql.includes('SELECT id FROM desktop_templates')) {
      const requested = params.map(String);
      return [[...this.mysql.templates].filter((id) => requested.includes(id)).map((id) => ({ id })), {}];
    }
    throw new Error(`Unexpected connection query: ${sql}`);
  }
}

async function createApp(mysql: FakeMysql): Promise<{ app: FastifyInstance; token: (userId: string) => string }> {
  const root = await mkdtemp(join(tmpdir(), 'desktop-sidebar-'));
  roots.push(root);
  const app = Fastify({ logger: false });
  apps.push(app);
  await app.register(jwt, { secret: 'desktop-sidebar-test-secret' });
  await app.register(multipart);
  app.decorate('mysql', mysql as never);
  app.decorate('authenticate', async (request) => request.jwtVerify());
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AiDirectHiringError) {
      return reply.status(error.httpStatus).send(errorResponse(error));
    }
    const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number'
      ? (error as { statusCode: number }).statusCode
      : 500;
    return reply.status(statusCode).send(errorResponse(error));
  });
  const store = new ManagedAssetStore(root);
  await app.register(createDesktopPreferencesRoutes(store), { prefix: '/api/v1/desktop' });
  await app.ready();
  return { app, token: (userId) => app.jwt.sign({ id: userId, role: 'user' }) };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('desktop sidebar synchronization', () => {
  it('requires authentication and isolates account state', async () => {
    const mysql = new FakeMysql();
    const { app, token } = await createApp(mysql);
    const unauthenticated = await app.inject({ method: 'GET', url: '/api/v1/desktop/sidebar' });
    expect(unauthenticated.statusCode).toBe(401);

    mysql.preferences.set('user-a', {
      config: validConfig(),
      revision: 3n,
      updatedAt: new Date('2026-08-01T00:00:00Z'),
    });
    const own = await app.inject({
      method: 'GET',
      url: '/api/v1/desktop/sidebar',
      headers: { authorization: `Bearer ${token('user-a')}` },
    });
    expect(own.statusCode).toBe(200);
    expect(own.headers.etag).toBe('"sidebar-3"');
    expect(own.json().overridden).toBe(true);

    const other = await app.inject({
      method: 'GET',
      url: '/api/v1/desktop/sidebar',
      headers: { authorization: `Bearer ${token('user-b')}` },
    });
    expect(other.statusCode).toBe(200);
    expect(other.headers.etag).toBe('"sidebar-0"');
    expect(other.json()).toMatchObject({ overridden: false, config: null, revision: '0' });
  });

  it('creates with revision zero and rejects a stale concurrent write', async () => {
    const mysql = new FakeMysql();
    const { app, token } = await createApp(mysql);
    const authorization = `Bearer ${token('user-a')}`;
    const first = await app.inject({
      method: 'PUT',
      url: '/api/v1/desktop/sidebar',
      headers: { authorization, 'if-match': '"sidebar-0"' },
      payload: validConfig(),
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers.etag).toBe('"sidebar-1"');

    const stale = await app.inject({
      method: 'PUT',
      url: '/api/v1/desktop/sidebar',
      headers: { authorization, 'if-match': '"sidebar-0"' },
      payload: validConfig(),
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      code: 'REVISION_CONFLICT',
      details: { currentRevision: '1', etag: '"sidebar-1"' },
    });
  });

  it('requires If-Match and rejects local template business data', async () => {
    const mysql = new FakeMysql();
    const { app, token } = await createApp(mysql);
    const authorization = `Bearer ${token('user-a')}`;
    const missingPrecondition = await app.inject({
      method: 'PUT',
      url: '/api/v1/desktop/sidebar',
      headers: { authorization },
      payload: validConfig(),
    });
    expect(missingPrecondition.statusCode).toBe(428);
    expect(missingPrecondition.json().code).toBe('PRECONDITION_REQUIRED');

    const leakedData = await app.inject({
      method: 'PUT',
      url: '/api/v1/desktop/sidebar',
      headers: { authorization, 'if-match': '"sidebar-0"' },
      payload: { ...validConfig(), localStorage: { tasks: ['secret'] } },
    });
    expect(leakedData.statusCode).toBe(400);
    expect(leakedData.json().code).toBe('VALIDATION_ERROR');
  });

  it('rejects a Logo owned by another account', async () => {
    const mysql = new FakeMysql();
    const foreignAssetId = '00000000-0000-4000-8000-000000000010';
    mysql.assets.set(foreignAssetId, { id: foreignAssetId, userId: 'user-b', deletedAt: null });
    const { app, token } = await createApp(mysql);
    const config = validConfig();
    config.items[0]!.iconAssetId = foreignAssetId;
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/desktop/sidebar',
      headers: {
        authorization: `Bearer ${token('user-a')}`,
        'if-match': '"sidebar-0"',
      },
      payload: config,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN_SCOPE');
  });

  it('resets an override only at the current revision', async () => {
    const mysql = new FakeMysql();
    mysql.preferences.set('user-a', { config: validConfig(), revision: 4n, updatedAt: new Date() });
    const { app, token } = await createApp(mysql);
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/desktop/sidebar',
      headers: {
        authorization: `Bearer ${token('user-a')}`,
        'if-match': '"sidebar-4"',
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers.etag).toBe('"sidebar-0"');
    expect(mysql.preferences.has('user-a')).toBe(false);
  });
});

function validConfig() {
  return {
    version: 1 as const,
    items: [{
      itemId: 'home',
      type: 'builtin' as const,
      label: '首页',
      order: 0,
      visible: true,
      target: 'home',
      iconAssetId: undefined as string | undefined,
    }],
  };
}