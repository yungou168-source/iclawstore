import { afterEach, describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import {
  assertDesktopContractRoutes,
  DESKTOP_CLIENT_CONTRACT_ROUTES,
  missingDesktopContractRoutes,
} from "../src/desktopContractManifest.js";
import { createAiDirectCoreRoutes } from "../src/routes/aiDirectCore.js";
import {
  DESKTOP_CLIENT_CONTRACT_VERSION,
  desktopAuthDiscoveryFromEnvironment,
  desktopContractRoutes,
  paidHiringSupportedFromEnvironment,
} from "../src/routes/desktopContract.js";
import { createDesktopPreferencesRoutes } from "../src/routes/desktopPreferences.js";
import { desktopTemplateReviewRoutes } from "../src/routes/desktopTemplateReview.js";
import { createDesktopTemplateRoutes } from "../src/routes/desktopTemplates.js";
import type { ManagedAssetStore } from "../src/services/managedAssetStore.js";

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const routeKey = (method: string, path: string): string => `${method.toUpperCase()} ${path}`;

function extractOpenApiRoutes(document: string): string[] {
  const routes: string[] = [];
  let path: string | undefined;
  for (const line of document.split("\n")) {
    const pathMatch = line.match(/^  (\/api\/[^:]+):\s*$/);
    if (pathMatch) {
      path = pathMatch[1];
      continue;
    }

    const methodMatch = line.match(/^    (get|post|put|patch|delete):\s*$/);
    if (path && methodMatch) routes.push(routeKey(methodMatch[1], path));
  }
  return routes.sort();
}

async function createCompleteContractApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  apps.push(app);
  app.decorate("mysql", {});
  app.decorate("authenticate", async () => {
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  });
  const assetStore = {} as ManagedAssetStore;
  await app.register(desktopContractRoutes, { prefix: "/api/v1/desktop" });
  await app.register(createAiDirectCoreRoutes(assetStore), {
    prefix: "/api/v1/ai-direct-hiring",
  });
  await app.register(createDesktopPreferencesRoutes(assetStore), { prefix: "/api/v1/desktop" });
  await app.register(createDesktopTemplateRoutes(assetStore), { prefix: "/api/v1/desktop" });
  await app.register(desktopTemplateReviewRoutes, { prefix: "/api/v1/desktop" });
  await app.ready();
  return app;
}

describe("desktop client contract", () => {
  it("exposes stable unauthenticated discovery metadata", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(desktopContractRoutes, { prefix: "/api/v1/desktop" });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/desktop/contract",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      contract: "clawhub-desktop-client",
      version: DESKTOP_CLIENT_CONTRACT_VERSION,
      openapi: "/api/v1/desktop/openapi.yaml",
      documentation: "/docs/AI_DIRECT_DESKTOP_CLIENT_API_V1.md",
      purchaseSupported: false,
      paidHiringSupported: false,
    });
  });

  it("enables paid hiring discovery only after the explicit release gate", () => {
    expect(paidHiringSupportedFromEnvironment({})).toBe(false);
    expect(
      paidHiringSupportedFromEnvironment({ PAID_HIRING_RELEASE_READY: "false" }),
    ).toBe(false);
    expect(
      paidHiringSupportedFromEnvironment({ PAID_HIRING_RELEASE_READY: "invalid" }),
    ).toBe(false);
    expect(
      paidHiringSupportedFromEnvironment({ PAID_HIRING_RELEASE_READY: "true" }),
    ).toBe(true);
  });

  it("serves the same OpenAPI version declared by discovery", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(desktopContractRoutes, { prefix: "/api/v1/desktop" });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/desktop/openapi.yaml",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/vnd.oai.openapi");
    expect(response.body).toContain("openapi: 3.1.0");
    expect(response.body).toContain(`version: ${DESKTOP_CLIENT_CONTRACT_VERSION}`);
    expect(response.body).toContain("  - url: https://www.iclawstore.com");
  });

  it("keeps every OpenAPI operation synchronized with the release manifest", async () => {
    const document = await readFile("openapi/desktop-client-v1.yaml", "utf8");
    const manifestRoutes = DESKTOP_CLIENT_CONTRACT_ROUTES.map(({ method, openApiPath }) =>
      routeKey(method, openApiPath),
    ).sort();

    expect(extractOpenApiRoutes(document)).toEqual(manifestRoutes);
  });

  it("accepts the complete 1.2.0 runtime route surface", async () => {
    const app = await createCompleteContractApp();

    expect(missingDesktopContractRoutes(app)).toEqual([]);
    expect(() => assertDesktopContractRoutes(app)).not.toThrow();
  });

  it("rejects startup when an advertised runtime route is absent", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(desktopContractRoutes, { prefix: "/api/v1/desktop" });
    await app.ready();

    expect(() => assertDesktopContractRoutes(app)).toThrow(
      "GET /api/v1/ai-direct-hiring/agents/{agentId}/appearance",
    );
  });

  it("builds optional OAuth discovery from the locked server configuration", () => {
    expect(
      desktopAuthDiscoveryFromEnvironment({
        CONVEX_DESKTOP_AUTH_ISSUER: "https://example.com/convex/oauth/desktop/",
        AI_DIRECT_DESKTOP_OAUTH_CLIENT_ID: "desktop-client",
        CONVEX_DESKTOP_AUTH_AUDIENCE: "https://api.example.com/desktop",
      }),
    ).toEqual({
      issuer: "https://example.com/convex/oauth/desktop",
      authorizationEndpoint: "https://example.com/convex/oauth/desktop/authorize",
      tokenEndpoint: "https://example.com/convex/oauth/desktop/token",
      userinfoEndpoint: "https://example.com/convex/oauth/desktop/userinfo",
      jwksUri: "https://example.com/convex/oauth/desktop/.well-known/jwks.json",
      revocationEndpoint: "https://example.com/convex/oauth/desktop/revoke",
      clientId: "desktop-client",
      audience: "https://api.example.com/desktop",
      scopes: ["openid", "profile", "email", "offline_access"],
      codeChallengeMethods: ["S256"],
    });
  });

  it("omits auth only when both desktop OAuth settings are absent", () => {
    expect(desktopAuthDiscoveryFromEnvironment({})).toBeUndefined();
    expect(() =>
      desktopAuthDiscoveryFromEnvironment({
        CONVEX_DESKTOP_AUTH_ISSUER: "https://example.com/oauth/desktop",
      }),
    ).toThrow("must be configured together");
  });
});
