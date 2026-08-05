import { afterEach, describe, expect, it } from 'bun:test';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  DESKTOP_CLIENT_CONTRACT_VERSION,
  desktopContractRoutes,
} from '../src/routes/desktopContract.js';

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('desktop client contract', () => {
  it('exposes stable unauthenticated discovery metadata', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(desktopContractRoutes, { prefix: '/api/v1/desktop' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/desktop/contract',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      contract: 'clawhub-desktop-client',
      version: DESKTOP_CLIENT_CONTRACT_VERSION,
      openapi: '/api/v1/desktop/openapi.yaml',
      documentation: '/docs/AI_DIRECT_DESKTOP_CLIENT_API_V1.md',
      purchaseSupported: false,
    });
  });

  it('serves the same OpenAPI version declared by discovery', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(desktopContractRoutes, { prefix: '/api/v1/desktop' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/desktop/openapi.yaml',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/vnd.oai.openapi');
    expect(response.body).toContain('openapi: 3.1.0');
    expect(response.body).toContain(`version: ${DESKTOP_CLIENT_CONTRACT_VERSION}`);
  });
});