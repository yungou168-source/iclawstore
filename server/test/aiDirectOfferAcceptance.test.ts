import { describe, expect, it, vi } from "bun:test";
import { aiDirectOffersRoutes } from "../src/routes/aiDirectOffers.js";
import { ErrorCodes } from "../src/services/aiDirectErrors.js";

type RegisteredRoute = {
  path: string;
  handler: (request: unknown, reply: unknown) => Promise<unknown>;
};

async function registeredPostRoutes(): Promise<RegisteredRoute[]> {
  const routes: RegisteredRoute[] = [];
  const fastify = {
    mysql: { query: vi.fn() },
    authenticate: vi.fn(),
    get: vi.fn(),
    post: vi.fn((path: string, _options: unknown, handler: RegisteredRoute["handler"]) => {
      routes.push({ path, handler });
    }),
  };
  await aiDirectOffersRoutes(fastify as any);
  return routes;
}

describe("immutable paid Offer routes", () => {
  it("keeps every legacy Offer write path registered as a stable business rejection", async () => {
    const routes = await registeredPostRoutes();
    expect(routes.map(({ path }) => path)).toEqual([
      "/offers",
      "/offers/:id/submit",
      "/offers/:id/approve",
      "/offers/:id/reject",
      "/offers/:id/send",
      "/offers/:id/accept",
      "/offers/:id/decline",
      "/offers/:id/revoke",
      "/offers/:id/expire",
    ]);

    for (const route of routes) {
      await expect(route.handler({}, {})).rejects.toMatchObject({
        code: ErrorCodes.INVALID_TRANSITION,
        httpStatus: 409,
        details: { replacement: "POST /paid-hiring/orders" },
      });
    }
  });
});
