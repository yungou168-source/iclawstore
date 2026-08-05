import { afterEach, describe, expect, it } from 'bun:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { aiDirectCompaniesRoutes } from '../src/routes/aiDirectCompanies.js';
import { aiDirectOrganizationsRoutes } from '../src/routes/aiDirectOrganizations.js';
import { AiDirectHiringError, errorResponse } from '../src/services/aiDirectErrors.js';

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function appWith(routes: (app: FastifyInstance) => Promise<void>, mysql: unknown) {
  const app = Fastify({ logger: false });
  apps.push(app);
  app.decorate('mysql', mysql);
  app.decorate('authenticate', async (request: any) => { request.user = { id: 'actor-1' }; });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AiDirectHiringError) return reply.status(error.httpStatus).send(errorResponse(error));
    return reply.status(500).send(errorResponse(error));
  });
  await app.register(routes);
  await app.ready();
  return app;
}

describe('AI Direct organization management routes', () => {
  it('returns a stable cursor, status-filtered organizations and server permissions', async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const mysql = {
      query: async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values });
        return [[
          { id: 'org-2', name: 'Two', slug: 'two', status: 'active', role: 'admin', updatedAt: new Date('2026-08-05T10:00:00Z') },
          { id: 'org-1', name: 'One', slug: 'one', status: 'active', role: 'member', updatedAt: new Date('2026-08-04T10:00:00Z') },
        ]];
      },
    };
    const app = await appWith(aiDirectOrganizationsRoutes, mysql);
    const response = await app.inject({ method: 'GET', url: '/organizations?status=active&limit=1' });
    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].permissions).toContain('organization.members.manage');
    expect(typeof payload.nextCursor).toBe('string');
    expect(calls[0]?.sql).toContain('o.status = ?');
    expect(calls[0]?.sql).toContain('o.updatedAt DESC, o.id DESC');
  });

  it('archives an inactive company without physical deletion and keeps organization scope', async () => {
    const statements: Array<{ sql: string; values?: unknown[] }> = [];
    const connection = {
      beginTransaction: async () => undefined,
      commit: async () => undefined,
      rollback: async () => undefined,
      release: () => undefined,
      query: async (sql: string, values?: unknown[]) => {
        statements.push({ sql, values });
        if (sql.includes('SELECT id, organizationId, status')) {
          return [[{ id: 'company-1', organizationId: 'org-1', status: 'inactive' }]];
        }
        if (sql.includes('AS activeProjects')) {
          return [[{ activeProjects: 0, openRoles: 0, activeOffers: 0, activeEmployments: 0 }]];
        }
        return [[]];
      },
    };
    const mysql = {
      query: async () => [[{ companyId: 'company-1', orgRole: 'owner', companyRole: 'owner', status: 'active' }]],
      getConnection: async () => connection,
    };
    const app = await appWith(aiDirectCompaniesRoutes, mysql);
    const response = await app.inject({ method: 'DELETE', url: '/companies/company-1' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: 'company-1', organizationId: 'org-1', status: 'archived' });
    expect(statements.some(({ sql }) => /DELETE FROM ai_direct_companies/.test(sql))).toBe(false);
    expect(statements.some(({ sql }) => sql.includes("SET status = 'archived'"))).toBe(true);
    const audit = statements.find(({ sql }) => sql.includes('INSERT INTO ai_direct_audit_events'));
    const outbox = statements.find(({ sql }) => sql.includes('INSERT INTO ai_direct_outbox_events'));
    expect(audit?.values).toContain('org-1');
    expect(outbox?.values).toContain('org-1');
  });

  it('rejects revoking the last active organization owner', async () => {
    const connection = {
      beginTransaction: async () => undefined,
      commit: async () => undefined,
      rollback: async () => undefined,
      release: () => undefined,
      query: async (sql: string) => {
        if (sql.includes('SELECT role, status')) return [[{ role: 'owner', status: 'active' }]];
        if (sql.includes('COUNT(*) AS count')) return [[{ count: 1 }]];
        return [[]];
      },
    };
    const mysql = {
      query: async () => [[{ role: 'owner' }]],
      getConnection: async () => connection,
    };
    const app = await appWith(aiDirectOrganizationsRoutes, mysql);
    const response = await app.inject({ method: 'DELETE', url: '/organizations/org-1/members/owner-1' });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('INVALID_TRANSITION');
  });
});