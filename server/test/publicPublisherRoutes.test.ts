import { afterEach, describe, expect, it, vi } from "bun:test";
import { Readable } from "node:stream";
import Fastify from "fastify";
import type {
  PublicPublisherListItem,
  PublicPublisherMembers,
  PublicPublisherPage,
} from "../src/domains/publishers/publicPublisherPort.js";
import {
  publicPublisherAssetRoutes,
  publicPublishersRoutes,
} from "../src/routes/publicPublishers.js";

const apps: Array<ReturnType<typeof Fastify>> = [];

const publisher: PublicPublisherListItem = {
  _id: "publishers:acme",
  _creationTime: 1,
  kind: "org",
  handle: "acme",
  displayName: "Acme",
  image: "/api/publisher-assets/asset-org/content",
  bio: "Builds tools",
  linkedUserId: null,
  official: true,
  stats: { skills: 2, packages: 1, installs: 10, downloads: 20, stars: 3 },
  publishedItems: [],
};

const page: PublicPublisherPage = {
  page: [publisher],
  counts: { all: 1, organizations: 1, individuals: 0 },
  globalCounts: { all: 1, organizations: 1, individuals: 0 },
  continueCursor: "",
  isDone: true,
};

const members: PublicPublisherMembers = {
  publisher,
  members: [
    {
      role: "owner",
      user: {
        _id: "users:alice",
        handle: "alice",
        displayName: "Alice",
        image: "/api/profile-assets/profile-asset/content",
        official: false,
      },
    },
  ],
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("public Publisher routes", () => {
  it("serves directory pages through the injected public Publisher port", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const publishers = {
      listPublicPage: vi.fn(async () => page),
      getProfileByHandle: vi.fn(async () => publisher),
      listMembers: vi.fn(async () => members),
    };
    await app.register(publicPublishersRoutes, { publishers });

    const response = await app.inject({
      method: "GET",
      url: "/publishers?kind=orgs&q=acme&cursor=25&numItems=5",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(page);
    expect(publishers.listPublicPage).toHaveBeenCalledWith({
      kind: "org",
      query: "acme",
      paginationOpts: { cursor: "25", numItems: 5 },
    });
  });

  it("serves Publisher details and fails closed on missing authoritative reads", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const publishers = {
      listPublicPage: vi.fn(async () => page),
      getProfileByHandle: vi.fn(async (handle: string) => (handle === "acme" ? publisher : null)),
      listMembers: vi.fn(async () => members),
    };
    await app.register(publicPublishersRoutes, { publishers });

    const found = await app.inject({ method: "GET", url: "/publishers/acme" });
    expect(found.statusCode).toBe(200);
    expect(found.json()).toEqual(publisher);

    const missing = await app.inject({ method: "GET", url: "/publishers/missing" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "Publisher not found" });
  });

  it("serves public members without exposing member management writes", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const publishers = {
      listPublicPage: vi.fn(async () => page),
      getProfileByHandle: vi.fn(async () => publisher),
      listMembers: vi.fn(async () => members),
    };
    await app.register(publicPublishersRoutes, { publishers });

    const response = await app.inject({ method: "GET", url: "/publishers/acme/members" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(members);
    expect(publishers.listMembers).toHaveBeenCalledWith("acme");
  });

  it("serves only active public Publisher assets", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    app.decorate("mysql", {
      query: vi.fn(async () => [
        [
          {
            storageKey: "publishers/aa/00000000-0000-0000-0000-000000000000.png",
            originalFileName: "org.png",
            mimeType: "image/png",
            sha256: "b".repeat(64),
          },
        ],
        [],
      ]),
    });
    await app.register(publicPublisherAssetRoutes, {
      store: {
        open: vi.fn(async () => ({ stream: Readable.from([Buffer.from("png")]), sizeBytes: 3 })),
      },
    });

    const response = await app.inject({ method: "GET", url: "/publisher-assets/asset-1/content" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers.etag).toBe(`"${"b".repeat(64)}"`);
    expect(response.body).toBe("png");
  });
});
