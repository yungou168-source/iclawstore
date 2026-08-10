import { afterEach, describe, expect, it } from "bun:test";
import Fastify, { type FastifyInstance } from "fastify";
import { AuthRequiredError, type AuthenticatedUser } from "../src/middleware/aiDirectAuth.js";
import {
  aiDirectSessionRoutes,
  featureFlagConfigFromEnvironment,
  featureFlagsForOrganization,
} from "../src/routes/aiDirectSession.js";
import { AiDirectHiringError, errorResponse } from "../src/services/aiDirectErrors.js";

const apps: FastifyInstance[] = [];

const user: AuthenticatedUser = {
  id: "mysql-user-1",
  convexUserId: "convex-user-1",
  issuer: "https://example.convex.site",
  subject: "convex-user-1",
  authSource: "convex",
  email: "owner@example.com",
  displayName: "Owner",
  role: "user",
};

const organizations = [
  {
    id: "org-2",
    name: "Second",
    slug: "second",
    role: "manager",
    membershipUpdatedAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "org-1",
    name: "First",
    slug: "first",
    role: "owner",
    membershipUpdatedAt: "2026-08-02T00:00:00.000Z",
  },
];

const createApp = async (authenticated = true) => {
  const app = Fastify({ logger: false });
  apps.push(app);
  let authCalls = 0;
  app.decorateRequest("user", null);
  app.decorate("mysql", {
    query: async () => [organizations],
  });
  app.decorate("authenticate", async (request) => {
    authCalls += 1;
    if (!authenticated) throw new AuthRequiredError();
    request.user = user;
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AiDirectHiringError) {
      return reply.status(error.httpStatus).send(errorResponse(error));
    }
    return reply.status(500).send({ error: "Internal Server Error" });
  });
  await app.register(aiDirectSessionRoutes, { prefix: "/api/v1/ai-direct-hiring" });
  await app.ready();
  return { app, authCalls: () => authCalls };
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("AI Direct Hiring session", () => {
  it("returns mapped user, organizations, role permissions and requested current organization", async () => {
    const { app, authCalls } = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/ai-direct-hiring/session",
      headers: { "x-organization-id": "org-1" },
    });

    expect(response.statusCode).toBe(200);
    expect(authCalls()).toBe(1);
    expect(response.json()).toMatchObject({
      user: { id: "mysql-user-1", convexUserId: "convex-user-1", email: "owner@example.com" },
      currentOrganization: {
        id: "org-1",
        role: "owner",
        grantVersion: expect.any(String),
        permissions: [
          "organization:read",
          "organization:manage",
          "company:manage",
          "hiring:manage",
          "billing:manage",
        ],
      },
      organizations: [
        { id: "org-2", role: "manager" },
        { id: "org-1", role: "owner" },
      ],
      organizationSelection: {
        requestedOrganizationId: "org-1",
        resolvedOrganizationId: "org-1",
        source: "requested",
      },
      featureFlags: {
        aiDirectHiring: true,
        desktopIdentityBridge: true,
        candidateCatalog: false,
        interviews: false,
        providerExecution: false,
      },
      runtimeCapabilities: {
        desktopJobs: true,
        artifactDownload: false,
        candidateCatalog: false,
        interviews: false,
        providerExecution: false,
      },
    });
  });

  it("does not trust a requested organization outside the active membership result", async () => {
    const { app } = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/ai-direct-hiring/session",
      headers: { "x-organization-id": "revoked-org" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      currentOrganization: { id: "org-2" },
      organizationSelection: {
        requestedOrganizationId: "revoked-org",
        resolvedOrganizationId: "org-2",
        source: "default",
      },
    });
  });

  it("applies server-owned organization overrides without enabling undeclared capabilities", () => {
    const config = featureFlagConfigFromEnvironment({
      AI_DIRECT_FEATURE_FLAGS: JSON.stringify({
        defaults: { candidateCatalog: true },
        organizations: { "org-1": { candidateCatalog: false, interviews: true } },
      }),
    });

    expect(featureFlagsForOrganization("org-1", config)).toMatchObject({
      candidateCatalog: false,
      interviews: true,
      providerExecution: false,
    });
    expect(featureFlagsForOrganization("org-2", config)).toMatchObject({
      candidateCatalog: true,
      interviews: false,
      providerExecution: false,
    });
  });

  it("fails closed when authentication cannot establish an active identity", async () => {
    const { app } = await createApp(false);
    const response = await app.inject({ method: "GET", url: "/api/v1/ai-direct-hiring/session" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "AUTH_REQUIRED" });
  });
});
