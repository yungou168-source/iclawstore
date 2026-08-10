import { afterEach, describe, expect, it } from "bun:test";
import Fastify, { type FastifyInstance } from "fastify";
import { aiDirectCandidateMatchingRoutes } from "../src/routes/aiDirectCandidateMatching.js";

type QueryCall = { sql: string; values?: unknown[] };

const apps: FastifyInstance[] = [];
const previousFlags = process.env.AI_DIRECT_FEATURE_FLAGS;

const createApp = async (calls: QueryCall[]): Promise<FastifyInstance> => {
  const app = Fastify({ logger: false });
  apps.push(app);
  app.decorate("authenticate", async (request: { user?: { id: string; role: string } }) => {
    request.user = { id: "user-1", role: "member" };
  });
  app.decorate("mysql", {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.includes("FROM ai_direct_positions p"))
        return [
          [
            {
              id: "position-1",
              companyId: "company-1",
              organizationId: "org-1",
              status: "open",
              requirementsSummary: { requiredCapabilities: ["typescript"] },
            },
          ],
        ];
      if (sql.includes("FROM ai_direct_companies c"))
        return [
          [
            {
              companyId: "company-1",
              orgRole: "admin",
              companyRole: "recruiter",
              status: "active",
            },
          ],
        ];
      if (sql.includes("FROM ai_direct_position_agent_roles"))
        return [[{ requiredCapabilities: ["sql"] }]];
      return [
        [
          {
            agentId: "agent-b",
            displayName: "Beta",
            availability: "available",
            capabilitySummary: ["sql"],
            isEmployed: 0,
          },
          {
            agentId: "agent-a",
            displayName: "Alpha",
            availability: "available",
            capabilitySummary: ["sql", "typescript"],
            isEmployed: 1,
          },
        ],
      ];
    },
  });
  await app.register(aiDirectCandidateMatchingRoutes);
  await app.ready();
  return app;
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  if (previousFlags === undefined) delete process.env.AI_DIRECT_FEATURE_FLAGS;
  else process.env.AI_DIRECT_FEATURE_FLAGS = previousFlags;
});

describe("aiDirectCandidateMatchingRoutes", () => {
  it("matches an open authorized position from catalog digests only", async () => {
    process.env.AI_DIRECT_FEATURE_FLAGS = JSON.stringify({
      organizations: { "org-1": { candidateCatalog: true } },
    });
    const calls: QueryCall[] = [];
    const app = await createApp(calls);
    const response = await app.inject({
      method: "GET",
      url: "/workforce/positions/position-1/candidate-matches?limit=1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      scoringVersion: "capability-coverage-v1",
      positionId: "position-1",
      requiredCapabilities: ["sql", "typescript"],
      items: [
        {
          agentId: "agent-a",
          score: 100,
          viewerDisclosure: { isEmployedByCurrentOrganization: true },
        },
      ],
    });
    expect(response.json().nextCursor).toBeString();
    expect(calls.at(-1)?.sql).toContain("ai_direct_candidate_catalog_digests");
    expect(JSON.stringify(response.json())).not.toContain("promptSpec");
  });

  it("requires the candidate catalog organization flag", async () => {
    delete process.env.AI_DIRECT_FEATURE_FLAGS;
    const app = await createApp([]);
    const response = await app.inject({
      method: "GET",
      url: "/workforce/positions/position-1/candidate-matches",
    });
    expect(response.statusCode).toBe(403);
  });
});
