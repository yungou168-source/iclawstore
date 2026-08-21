import type { FastifyInstance } from 'fastify';
import type { PublicCatalogPort } from '../domains/skill-packages/publicCatalogPort.js';
import { registerCatalogRoutes } from './skills.js';

export async function packagesRoutes(fastify: FastifyInstance, options: Readonly<{ catalog?: PublicCatalogPort }> = {}): Promise<void> {
  await registerCatalogRoutes(fastify, 'package', options.catalog);
}