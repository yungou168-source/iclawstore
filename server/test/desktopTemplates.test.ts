import { afterEach, describe, expect, it } from 'bun:test';
import { Readable } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { createDesktopTemplateRoutes } from '../src/routes/desktopTemplates.js';
import { desktopTemplateReviewRoutes } from '../src/routes/desktopTemplateReview.js';
import { AiDirectHiringError, errorResponse } from '../src/services/aiDirectErrors.js';
import type { ManagedAssetStore } from '../src/services/managedAssetStore.js';

const apps: FastifyInstance[] = [];

class FakeTemplateMysql {
  publisherMembers = new Set<string>();
  admins = new Set<string>();
  templates = new Map<string, Record<string, unknown>>();
  createdTemplates: Array<Record<string, unknown>> = [];

  async query(sql: string, params: unknown[] = []): Promise<[unknown[], unknown]> {
    if (sql.includes('FROM publishers publisher') && sql.includes('publisherMembers')) {
      const userId = String(params[0]);
      const publisherId = String(params[1]);
      return [this.publisherMembers.has(`${publisherId}:${userId}`) ? [{ id: publisherId }] : [], {}];
    }
    if (sql.startsWith('INSERT INTO desktop_templates')) {
      const [id, publisherId, slug, name, description, pricingMode, priceMicros, currency, createdByUserId] = params;
      this.createdTemplates.push({
        id,
        publisherId,
        slug,
        name,
        description,
        pricingMode,
        priceMicros,
        currency,
        createdByUserId,
      });
      return [[], {}];
    }
    if (sql.startsWith('INSERT INTO desktop_template_download_events')) {
      return [[], {}];
    }
    if (sql.includes('FROM desktop_templates template') && sql.includes('WHERE template.id = ?')) {
      const id = String(params[1]);
      const template = this.templates.get(id);
      return [template ? [template] : [], {}];
    }
    if (sql.includes("FROM users WHERE id = ? AND role = 'admin'")) {
      return [this.admins.has(String(params[0])) ? [{ id: params[0] }] : [], {}];
    }
    throw new Error(`Unexpected query: ${sql}`);
  }
}

function fakeStore(): ManagedAssetStore {
  return {
    open: async () => ({ stream: Readable.from(Buffer.from('template-package')), sizeBytes: 16 }),
  } as unknown as ManagedAssetStore;
}

async function createApp(mysql: FakeTemplateMysql): Promise<{ app: FastifyInstance; token: (id: string) => string }> {
  const app = Fastify({ logger: false });
  apps.push(app);
  await app.register(jwt, { secret: 'desktop-template-test-secret' });
  await app.register(multipart);
  app.decorate('mysql', mysql as never);
  app.decorate('authenticate', async (request) => request.jwtVerify());
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AiDirectHiringError) {
      return reply.status(error.httpStatus).send(errorResponse(error));
    }
    return reply.status(500).send(errorResponse(error));
  });
  await app.register(createDesktopTemplateRoutes(fakeStore()), { prefix: '/api/v1/desktop' });
  await app.register(desktopTemplateReviewRoutes, { prefix: '/api/v1/desktop' });
  await app.ready();
  return { app, token: (id) => app.jwt.sign({ id, role: 'user' }) };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('desktop template catalog permissions', () => {
  it('requires authentication', async () => {
    const { app } = await createApp(new FakeTemplateMysql());
    const response = await app.inject({ method: 'GET', url: '/api/v1/desktop/templates' });
    expect(response.statusCode).toBe(401);
  });

  it('allows a Publisher member to create a draft and rejects non-members', async () => {
    const mysql = new FakeTemplateMysql();
    mysql.publisherMembers.add('publisher-1:member-user');
    const { app, token } = await createApp(mysql);
    const payload = {
      publisherId: 'publisher-1',
      slug: 'personal-workbench',
      name: '个人工作台',
      description: '本地个人工作台模板',
      pricingMode: 'free',
    };
    const allowed = await app.inject({
      method: 'POST',
      url: '/api/v1/desktop/templates',
      headers: { authorization: `Bearer ${token('member-user')}` },
      payload,
    });
    expect(allowed.statusCode).toBe(201);
    expect(allowed.json()).toMatchObject({ status: 'draft', purchaseSupported: false });
    expect(mysql.createdTemplates).toHaveLength(1);

    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/v1/desktop/templates',
      headers: { authorization: `Bearer ${token('stranger')}` },
      payload,
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().code).toBe('FORBIDDEN_SCOPE');
  });

  it('rejects paid package download without entitlement', async () => {
    const mysql = new FakeTemplateMysql();
    mysql.templates.set('template-paid', templateRow({
      id: 'template-paid',
      pricingMode: 'paid',
      entitlementStatus: null,
    }));
    const { app, token } = await createApp(mysql);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/desktop/templates/template-paid/package',
      headers: { authorization: `Bearer ${token('customer')}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: 'TEMPLATE_ENTITLEMENT_REQUIRED',
      details: { purchaseSupported: false },
    });
  });

  it('streams a free package with immutable and attachment headers', async () => {
    const mysql = new FakeTemplateMysql();
    mysql.templates.set('template-free', templateRow({
      id: 'template-free',
      pricingMode: 'free',
      entitlementStatus: null,
    }));
    const { app, token } = await createApp(mysql);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/desktop/templates/template-free/package',
      headers: { authorization: `Bearer ${token('customer')}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('template-package');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.headers.etag).toBe('"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"');
  });

  it('does not trust the JWT role for admin entitlement grants', async () => {
    const mysql = new FakeTemplateMysql();
    const { app, token } = await createApp(mysql);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/desktop/templates/template-paid/entitlements/customer',
      headers: { authorization: `Bearer ${token('not-admin')}` },
      payload: { reference: 'manual-test' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN_SCOPE');
  });
});

function templateRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'template-id',
    publisherId: 'publisher-1',
    publisherName: 'Publisher',
    slug: 'template-slug',
    name: 'Template',
    description: 'Template description',
    status: 'published',
    pricingMode: 'free',
    priceMicros: null,
    currency: null,
    activeVersionId: 'version-1',
    createdByUserId: 'template-owner',
    createdAt: new Date(),
    updatedAt: new Date(),
    versionId: 'version-1',
    version: '1.0.0',
    versionStatus: 'published',
    manifest: { version: '1.0.0' },
    dataSchemaVersion: 1,
    packageStorageKey: 'template_package/00/00000000-0000-4000-8000-000000000000.clawtemplate',
    packageOriginalFileName: 'template.clawtemplate',
    packageMimeType: 'application/zip',
    packageSizeBytes: 16,
    packageSha256: 'a'.repeat(64),
    entitlementStatus: null,
    ...overrides,
  };
}