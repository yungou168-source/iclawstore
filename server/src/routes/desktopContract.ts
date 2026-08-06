import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  DESKTOP_CLIENT_CONTRACT_VERSION,
  DESKTOP_CLIENT_OPENAPI_PATH,
} from '../desktopContractManifest.js';

export { DESKTOP_CLIENT_CONTRACT_VERSION, DESKTOP_CLIENT_OPENAPI_PATH };

export type DesktopAuthDiscovery = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  jwksUri: string;
  revocationEndpoint: string;
  clientId: string;
  audience: string;
  scopes: string[];
  codeChallengeMethods: ['S256'];
};

export function desktopAuthDiscoveryFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): DesktopAuthDiscovery | undefined {
  const issuer = env.CONVEX_DESKTOP_AUTH_ISSUER?.trim().replace(/\/$/, '');
  const clientId = env.AI_DIRECT_DESKTOP_OAUTH_CLIENT_ID?.trim();
  if (!issuer && !clientId) return undefined;
  if (!issuer || !clientId) {
    throw new Error(
      'CONVEX_DESKTOP_AUTH_ISSUER and AI_DIRECT_DESKTOP_OAUTH_CLIENT_ID must be configured together',
    );
  }

  return {
    issuer,
    authorizationEndpoint: `${issuer}/authorize`,
    tokenEndpoint: `${issuer}/token`,
    userinfoEndpoint: `${issuer}/userinfo`,
    jwksUri: `${issuer}/.well-known/jwks.json`,
    revocationEndpoint: `${issuer}/revoke`,
    clientId,
    audience:
      env.CONVEX_DESKTOP_AUTH_AUDIENCE?.trim() ||
      'https://www.iclawstore.com/api/v1/ai-direct-hiring',
    scopes: ['openid', 'profile', 'email', 'offline_access'],
    codeChallengeMethods: ['S256'],
  };
}

let openApiDocument: Promise<string> | undefined;

function loadOpenApiDocument(): Promise<string> {
  openApiDocument ??= readFile(
    join(process.cwd(), 'openapi', 'desktop-client-v1.yaml'),
    'utf8',
  );
  return openApiDocument;
}

export async function desktopContractRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/contract', async (_request, reply) => {
    const auth = desktopAuthDiscoveryFromEnvironment();
    return reply.status(200).send({
      contract: 'clawhub-desktop-client',
      version: DESKTOP_CLIENT_CONTRACT_VERSION,
      openapi: DESKTOP_CLIENT_OPENAPI_PATH,
      documentation: '/docs/AI_DIRECT_DESKTOP_CLIENT_API_V1.md',
      purchaseSupported: false,
      ...(auth ? { auth } : {}),
    });
  });

  fastify.get('/openapi.yaml', async (_request, reply) => {
    const document = await loadOpenApiDocument();
    return reply
      .header('Content-Type', 'application/vnd.oai.openapi;version=3.1.0;charset=utf-8')
      .header('Cache-Control', 'public, max-age=300')
      .send(document);
  });
}