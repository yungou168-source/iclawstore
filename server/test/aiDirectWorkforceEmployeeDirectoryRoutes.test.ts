import { afterEach, describe, expect, it } from 'bun:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { aiDirectWorkforceRoutes } from '../src/routes/aiDirectWorkforce.js';

type QueryCall = { sql: string; values?: unknown[] };
const apps: FastifyInstance[] = [];

const createApp = async (calls: QueryCall[], role = 'recruiter'): Promise<FastifyInstance> => {
  const app = Fastify({ logger: false });
  apps.push(app);
  app.decorate('authenticate', async (request: any) => { request.user = { id: 'user-1' }; });
  app.setErrorHandler((error: any, _request, reply) => reply.status(error.httpStatus ?? 500).send({ code: error.code }));
  app.decorate('mysql', {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.includes('ai_direct_organization_members')) {
        return [[{ companyId: 'company-1', orgRole: 'member', companyRole: role, status: 'active' }]];
      }
      if (sql.includes('ai_direct_workforce_employee_digests')) {
        return [[
          { employmentId: 'employment-2', agentId: 'agent-2', agentVersionId: 'version-2', agentDisplayName: 'Agent Two', avatarAssetId: null, departmentId: 'department-1', departmentName: 'Engineering', positionId: 'position-1', positionName: 'Analyst', roleId: 'role-1', roleName: 'Researcher', employmentStatus: 'active', startedAt: null, updatedAt: '2026-08-05T00:00:00.000Z' },
          { employmentId: 'employment-1', agentId: 'agent-1', agentVersionId: 'version-1', agentDisplayName: 'Agent One', avatarAssetId: null, departmentId: 'department-1', departmentName: 'Engineering', positionId: 'position-1', positionName: 'Analyst', roleId: 'role-1', roleName: 'Researcher', employmentStatus: 'active', startedAt: null, updatedAt: '2026-08-04T00:00:00.000Z' },
        ]];
      }
      return [[]];
    },
  });
  await app.register(aiDirectWorkforceRoutes);
  await app.ready();
  return app;
};

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('workforce employee directory route', () => {
  it('reads only employee digests with company RBAC and returns an opaque cursor', async () => {
    const calls: QueryCall[] = [];
    const app = await createApp(calls);
    const response = await app.inject({ method: 'GET', url: '/workforce/employees?companyId=company-1&departmentId=department-1&status=active&limit=1' });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    expect(response.json().nextCursor).toBeString();
    const digestQuery = calls.find((call) => call.sql.includes('ai_direct_workforce_employee_digests'));
    expect(digestQuery?.sql).toContain('ORDER BY d.updatedAt DESC, d.employmentId DESC');
    expect(digestQuery?.values).toEqual(['company-1', 'department-1', 'active', 2]);
    expect(JSON.stringify(response.json())).not.toContain('prompt');
  });

  it('uses cursor values in the indexed stable ordering predicate', async () => {
    const calls: QueryCall[] = [];
    const app = await createApp(calls);
    const cursor = Buffer.from(JSON.stringify({ updatedAt: '2026-08-05T00:00:00.000Z', employmentId: 'employment-2' })).toString('base64url');
    const response = await app.inject({ method: 'GET', url: `/workforce/employees?companyId=company-1&cursor=${cursor}` });

    expect(response.statusCode).toBe(200);
    const digestQuery = calls.find((call) => call.sql.includes('ai_direct_workforce_employee_digests'));
    expect(digestQuery?.sql).toContain('(d.updatedAt < ? OR (d.updatedAt = ? AND d.employmentId < ?))');
    expect(digestQuery?.values).toEqual(['company-1', '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z', 'employment-2', 21]);
  });

  it('rejects users below recruiter before reading digests', async () => {
    const calls: QueryCall[] = [];
    const app = await createApp(calls, 'member' as any);
    const response = await app.inject({ method: 'GET', url: '/workforce/employees?companyId=company-1' });

    expect(response.statusCode).toBe(403);
    expect(calls.some((call) => call.sql.includes('ai_direct_workforce_employee_digests'))).toBe(false);
  });
});