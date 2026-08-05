import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

export const DESKTOP_CLIENT_CONTRACT_VERSION = '1.0.0';
export const DESKTOP_CLIENT_OPENAPI_PATH = '/api/v1/desktop/openapi.yaml';

let openApiDocument: Promise<string> | undefined;

function loadOpenApiDocument(): Promise<string> {
  openApiDocument ??= readFile(
    join(process.cwd(), 'openapi', 'desktop-client-v1.yaml'),
    'utf8',
  );
  return openApiDocument;
}

export async function desktopContractRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/contract', async (_request, reply) => reply.status(200).send({
    contract: 'clawhub-desktop-client',
    version: DESKTOP_CLIENT_CONTRACT_VERSION,
    openapi: DESKTOP_CLIENT_OPENAPI_PATH,
    documentation: '/docs/AI_DIRECT_DESKTOP_CLIENT_API_V1.md',
    purchaseSupported: false,
  }));

  fastify.get('/openapi.yaml', async (_request, reply) => {
    const document = await loadOpenApiDocument();
    return reply
      .header('Content-Type', 'application/vnd.oai.openapi;version=3.1.0;charset=utf-8')
      .header('Cache-Control', 'public, max-age=300')
      .send(document);
  });
}