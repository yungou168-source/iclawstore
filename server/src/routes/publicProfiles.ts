import type { FastifyInstance } from 'fastify';
import { createPublicProfilePort } from '../domains/profiles/profilePortFactory.js';

export async function publicProfilesRoutes(fastify: FastifyInstance): Promise<void> {
  const profiles = createPublicProfilePort({
    convexUrl: process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL,
    mysql: process.env.DATABASE_URL?.startsWith('mysql') ? fastify.mysql : undefined,
    log: fastify.log,
  });

  fastify.get<{ Params: { slug: string } }>('/profiles/:slug', async (request, reply) => {
    const profile = await profiles.getBySlug(request.params.slug);
    if (!profile) return reply.status(404).send({ error: 'Profile not found' });
    return reply.send(profile);
  });
}