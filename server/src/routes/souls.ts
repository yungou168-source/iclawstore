import type { FastifyInstance } from 'fastify';
import type { SoulFactsRepository } from '../domains/souls/mysqlSoulFactsRepository.js';

const notFound = { type: 'object', required: ['error'], properties: { error: { type: 'string' } } } as const;

export const soulRoutes = async (fastify: FastifyInstance, options: Readonly<{ repository: SoulFactsRepository }>): Promise<void> => {
  fastify.get<{ Params: { slug: string } }>('/souls/:slug', { schema: { response: { 404: notFound } }, handler: async (request, reply) => {
    const soul = await options.repository.getBySlug(request.params.slug);
    return soul ? reply.send(soul) : reply.status(404).send({ error: 'Soul not found' });
  }});
  fastify.get<{ Params: { legacyId: string } }>('/souls/by-legacy-id/:legacyId', { schema: { response: { 404: notFound } }, handler: async (request, reply) => {
    const soul = await options.repository.getByLegacyId(request.params.legacyId);
    return soul ? reply.send(soul) : reply.status(404).send({ error: 'Soul not found' });
  }});
};