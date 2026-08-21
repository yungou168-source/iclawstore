import type { FastifyInstance } from 'fastify';
import { createMysqlPublicCatalogPort, type CatalogDomain, type PublicCatalogPort } from '../domains/skill-packages/publicCatalogPort.js';

type CatalogQuery = Readonly<{ page?: string; limit?: string; sort?: string }>;

const parsePositiveInteger = (value: string | undefined, fallback: number, max: number): number | null => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : null;
};

const registerCatalogRoutes = async (fastify: FastifyInstance, domain: CatalogDomain, catalog?: PublicCatalogPort): Promise<void> => {
  const port = catalog ?? createMysqlPublicCatalogPort(fastify.prisma);
  const singular = domain === 'skill' ? 'Skill' : 'Package';

  fastify.get('/', async (request, reply) => {
    const query = request.query as CatalogQuery;
    const page = parsePositiveInteger(query.page, 1, 100_000);
    const limit = parsePositiveInteger(query.limit, 20, 100);
    if (page === null || limit === null) return reply.status(400).send({ error: 'page and limit must be positive integers' });
    return port.list({ domain, page, limit, sort: query.sort ?? 'downloads' });
  });

  fastify.get<{ Params: { name: string } }>('/resolve/:name', async (request, reply) => {
    const entry = await port.resolve({ domain, name: request.params.name });
    return entry ? reply.send(entry) : reply.status(404).send({ error: `${singular} not found` });
  });

  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const entry = await port.getById({ domain, id: request.params.id });
    return entry ? reply.send(entry) : reply.status(404).send({ error: `${singular} not found` });
  });

  fastify.get<{ Params: { id: string } }>('/:id/versions', async (request, reply) => {
    const query = request.query as CatalogQuery;
    const page = parsePositiveInteger(query.page, 1, 100_000);
    const limit = parsePositiveInteger(query.limit, 20, 100);
    if (page === null || limit === null) return reply.status(400).send({ error: 'page and limit must be positive integers' });
    const result = await port.listVersions({ domain, id: request.params.id, page, limit });
    if (!result) return reply.status(404).send({ error: `${singular} not found` });
    return reply.send({ versions: result.versions, pagination: { page, limit, total: result.total, pages: Math.ceil(result.total / limit) } });
  });

  fastify.get<{ Params: { id: string; version: string } }>('/:id/versions/:version', async (request, reply) => {
    const version = await port.getVersion({ domain, id: request.params.id, version: request.params.version });
    return version ? reply.send(version) : reply.status(404).send({ error: `${singular} version not found` });
  });

  fastify.get<{ Params: { id: string; version: string; artifactPath: string } }>('/:id/versions/:version/artifacts/*', async (_request, reply) =>
    reply.status(503).send({ error: 'Artifact download is unavailable until managed asset migration completes' }),
  );
};

export async function skillsRoutes(fastify: FastifyInstance, options: Readonly<{ catalog?: PublicCatalogPort }> = {}): Promise<void> {
  await registerCatalogRoutes(fastify, 'skill', options.catalog);
}

export { registerCatalogRoutes };