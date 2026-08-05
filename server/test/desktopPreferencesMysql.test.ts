import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { createPool, type Pool } from 'mysql2/promise';
import { createDesktopPreferencesRoutes } from '../src/routes/desktopPreferences.js';
import { AiDirectHiringError, errorResponse } from '../src/services/aiDirectErrors.js';
import { ManagedAssetStore } from '../src/services/managedAssetStore.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('Desktop sidebar MySQL revision closure', () => {
  let app: FastifyInstance;
  let pool: Pool;
  let assetRoot: string;
  let authorization: string;

  beforeAll(async () => {
    pool = createPool({ uri: databaseUrl!, connectionLimit: 3 });
    await pool.query("DELETE FROM desktop_sidebar_preferences WHERE userId = 'sidebar-concurrent-user'");
    await pool.query(
      `INSERT INTO desktop_sidebar_preferences
         (userId, config, revision, createdAt, updatedAt)
       VALUES ('sidebar-concurrent-user', CAST(? AS JSON), 1, NOW(3), NOW(3))`,
      [JSON.stringify(sidebarConfig('Initial'))],
    );

    assetRoot = await mkdtemp(join(tmpdir(), 'clawhub-sidebar-mysql-'));
    const assetStore = new ManagedAssetStore(assetRoot);
    await assetStore.initialize();
    app = Fastify({ logger: false });
    await app.register(jwt, { secret: 'desktop-sidebar-mysql-secret' });
    await app.register(multipart);
    app.decorate('mysql', pool);
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
    await app.register(createDesktopPreferencesRoutes(assetStore), { prefix: '/api/v1/desktop' });
    await app.ready();
    authorization = `Bearer ${app.jwt.sign({ id: 'sidebar-concurrent-user', role: 'user' })}`;
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    if (assetRoot) await rm(assetRoot, { recursive: true, force: true });
  });

  it('serializes two devices writing the same revision', async () => {
    const write = (label: string) => app.inject({
      method: 'PUT',
      url: '/api/v1/desktop/sidebar',
      headers: { authorization, 'if-match': '"sidebar-1"' },
      payload: sidebarConfig(label),
    });
    const responses = await Promise.all([write('Device A'), write('Device B')]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);

    const success = responses.find((response) => response.statusCode === 200)!;
    const conflict = responses.find((response) => response.statusCode === 409)!;
    expect(success.headers.etag).toBe('"sidebar-2"');
    expect(conflict.json()).toMatchObject({
      code: 'REVISION_CONFLICT',
      details: { currentRevision: '2', etag: '"sidebar-2"' },
    });

    const [rows] = await pool.query<any[]>(
      "SELECT config, revision FROM desktop_sidebar_preferences WHERE userId = 'sidebar-concurrent-user'",
    );
    expect(String(rows[0]?.revision)).toBe('2');
    const storedConfig = typeof rows[0]?.config === 'string' ? JSON.parse(rows[0].config) : rows[0]?.config;
    expect(['Device A', 'Device B']).toContain(storedConfig.items[0].label);
  });
});

function sidebarConfig(label: string) {
  return {
    version: 1 as const,
    items: [{
      itemId: 'home',
      type: 'builtin' as const,
      label,
      order: 0,
      visible: true,
      target: 'home',
    }],
  };
}