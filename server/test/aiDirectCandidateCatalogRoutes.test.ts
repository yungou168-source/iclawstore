import { afterEach, describe, expect, it } from 'bun:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { aiDirectCandidateCatalogRoutes } from '../src/routes/aiDirectCandidateCatalog.js';

type QueryCall = { sql: string; values?: unknown[] };

const apps: FastifyInstance[] = [];
const previousFlags = process.env.AI_DIRECT_FEATURE_FLAGS;

const createApp = async (queryCalls: QueryCall[]): Promise<FastifyInstance> => {
  const app = Fastify({ logger: false });
  apps.push(app);
  app.decorate('authenticate', async (request: { user?: { id: string; role: string } }) => {
    request.user = { id: 'user-1', role: 'member' };
  });
  app.decorate('mysql', {
    query: async (sql: string, values?: unknown[]) => {
      queryCalls.push({ sql, values });
      if (sql.includes('FROM ai_direct_organizations')) return [[{ id: 'org-1' }]];
      if (sql.includes('WHERE d.agentId = ?')) return [[{
        agentId: 'agent-1',
        agentVersionId: 'version-1',
        displayName: 'Research Agent',
        summary: 'Safe summary',
        categoryKey: 'research',
        capabilitySummary: ['summarize'],
        appearanceAssetId: 'asset-1',
        availability: 'available',
        priceStatus: 'internal_use',
        isEmployed: 0,
      }]];
      return [[{
        agentId: 'agent-1',
        agentVersionId: 'version-1',
        displayName: 'Research Agent',
        summary: 'Safe summary',
        categoryKey: 'research',
        capabilitySummary: ['summarize'],
        appearanceAssetId: 'asset-1',
        availability: 'available',
        priceStatus: 'internal_use',
        isEmployed: 0,
      }]];
    },
  });
  await app.register(aiDirectCandidateCatalogRoutes);
  await app.ready();
  return app;
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  if (previousFlags === undefined) delete process.env.AI_DIRECT_FEATURE_FLAGS;
  else process.env.AI_DIRECT_FEATURE_FLAGS = previousFlags;
});

describe('aiDirectCandidateCatalogRoutes', () => {
  it('uses the authenticated organization and indexed search without exposing source internals', async () => {
    process.env.AI_DIRECT_FEATURE_FLAGS = JSON.stringify({ organizations: { 'org-1': { candidateCatalog: true } } });
    const calls: QueryCall[] = [];
    const app = await createApp(calls);

    const response = await app.inject({
      method: 'GET',
      url: '/catalog/agents?search=Research%20Agent&category=research',
      headers: { 'x-organization-id': 'org-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items[0]).toEqual({
      agentId: 'agent-1',
      agentVersionId: 'version-1',
      displayName: 'Research Agent',
      summary: 'Safe summary',
      category: 'research',
      capabilitySummary: ['summarize'],
      appearanceAssetId: 'asset-1',
      availability: 'available',
      priceStatus: 'internal_use',
      viewerDisclosure: { isEmployedByCurrentOrganization: false },
    });
    expect(JSON.stringify(response.json())).not.toContain('promptSpec');
    expect(calls.at(-1)?.sql).toContain('MATCH(d.searchText) AGAINST (? IN BOOLEAN MODE)');
    expect(calls.at(-1)?.values).toContain('+research* +agent*');
  });

  it('rejects catalogs without an explicitly enabled organization flag', async () => {
    delete process.env.AI_DIRECT_FEATURE_FLAGS;
    const app = await createApp([]);
    const response = await app.inject({ method: 'GET', url: '/catalog/agents', headers: { 'x-organization-id': 'org-1' } });
    expect(response.statusCode).toBe(403);
  });

  it('returns details from the same digest and organization count projection', async () => {
    process.env.AI_DIRECT_FEATURE_FLAGS = JSON.stringify({ organizations: { 'org-1': { candidateCatalog: true } } });
    const calls: QueryCall[] = [];
    const app = await createApp(calls);
    const response = await app.inject({ method: 'GET', url: '/catalog/agents/agent-1', headers: { 'x-organization-id': 'org-1' } });

    expect(response.statusCode).toBe(200);
    expect(response.json().agentId).toBe('agent-1');
    expect(calls.at(-1)?.values).toEqual(['org-1', 'agent-1']);
  });
});