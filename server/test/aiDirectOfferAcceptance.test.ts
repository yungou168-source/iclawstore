import { describe, expect, it, vi } from 'bun:test';
import { aiDirectOffersRoutes } from '../src/routes/aiDirectOffers.js';

type RegisteredRoute = { path: string; handler: (request: any, reply: any) => Promise<unknown> };

function reply() {
  const response = {
    status: vi.fn(() => response),
    send: vi.fn((body: unknown) => body),
  };
  return response;
}

async function acceptHandler(pool: any): Promise<RegisteredRoute['handler']> {
  const routes: RegisteredRoute[] = [];
  const fastify = {
    mysql: pool,
    authenticate: vi.fn(),
    get: vi.fn(),
    post: vi.fn((path: string, _options: unknown, handler: RegisteredRoute['handler']) => {
      routes.push({ path, handler });
    }),
  };
  await aiDirectOffersRoutes(fastify as any);
  const route = routes.find(({ path }) => path === '/offers/:id/accept');
  if (!route) throw new Error('accept route not registered');
  return route.handler;
}

const sentOffer = {
  id: 'offer-1',
  status: 'sent',
  proposedByUserId: 'user-1',
  companyId: 'company-1',
  roleId: 'role-1',
  agentVersionId: 'version-1',
  projectId: null,
};

describe('POST /offers/:id/accept', () => {
  it('serializes the no-profile case on the Agent and creates one Employment', async () => {
    const queries: string[] = [];
    const conn = {
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('SELECT * FROM ai_direct_offers')) return [[sentOffer], []];
        if (sql.includes('SELECT id, status FROM ai_direct_employments')) return [[], []];
        if (sql.includes('SELECT agentId FROM ai_direct_agent_versions')) return [[{ agentId: 'agent-1' }], []];
        if (sql.includes('SELECT id FROM ai_direct_agents')) return [[{ id: 'agent-1' }], []];
        if (sql.includes('SELECT controllerEmploymentId')) return [[], []];
        if (sql.includes('FROM ai_direct_position_agent_roles')) return [[{ id: 'position-1', status: 'open', headcountTarget: 1, headcountFilled: 0 }], []];
        if (sql.includes('SELECT o.*, r.name AS roleName')) return [[{ ...sentOffer, status: 'accepted' }], []];
        if (sql.includes('FROM ai_direct_employments e')) return [[{
          employmentId: 'employment-1',
          organizationId: 'organization-1',
          companyId: 'company-1',
          departmentId: 'department-1',
          positionId: 'position-1',
          roleId: 'role-1',
          agentId: 'agent-1',
          agentVersionId: 'version-1',
          agentDisplayName: 'Agent 1',
          avatarAssetId: null,
          departmentName: 'Engineering',
          positionName: 'Developer',
          roleName: 'Engineer',
          employmentStatus: 'accepted',
          startedAt: null,
        }], []];
        return [{ affectedRows: 1 }, []];
      }),
    };
    const pool = {
      query: vi.fn(async () => [[sentOffer], []]),
      getConnection: vi.fn(async () => conn),
    };

    const handler = await acceptHandler(pool);
    const result = await handler(
      { user: { id: 'user-1' }, params: { id: 'offer-1' }, headers: {} },
      reply(),
    );

    expect(result).toMatchObject({ status: 'accepted', employmentStatus: 'accepted' });
    expect(queries.some((sql) => sql.includes('SELECT id FROM ai_direct_agents') && sql.includes('FOR UPDATE'))).toBe(true);
    expect(queries.filter((sql) => sql.includes('INSERT INTO ai_direct_employments'))).toHaveLength(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it('returns the existing Employment for a committed acceptance replay', async () => {
    const acceptedOffer = { ...sentOffer, status: 'accepted' };
    const conn = {
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT * FROM ai_direct_offers')) return [[acceptedOffer], []];
        if (sql.includes('SELECT id, status FROM ai_direct_employments')) return [[{ id: 'employment-1', status: 'accepted' }], []];
        return [[], []];
      }),
    };
    const pool = {
      query: vi.fn(async () => [[acceptedOffer], []]),
      getConnection: vi.fn(async () => conn),
    };

    const handler = await acceptHandler(pool);
    const result = await handler(
      { user: { id: 'user-1' }, params: { id: 'offer-1' }, headers: {} },
      reply(),
    );

    expect(result).toMatchObject({ employmentId: 'employment-1', replayed: true });
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
  });
});