import { afterEach, describe, expect, it, vi } from "bun:test";
import { Readable } from "node:stream";
import Fastify from "fastify";
import { createPublicIdentityPort } from "../src/domains/identities/publicIdentityPort.js";
import type { PublicProfile } from "../src/domains/profiles/publicProfilePort.js";
import { publicProfileAssetRoutes, publicProfilesRoutes } from "../src/routes/publicProfiles.js";

const apps: Array<ReturnType<typeof Fastify>> = [];

const profile: PublicProfile = {
  user: {
    _id: "users:alice",
    _creationTime: 1,
    handle: "alice",
    displayName: "Alice",
  },
  profileSlug: "alice",
  publisher: { handle: "alice-publisher", displayName: "Alice" },
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("public profile identities", () => {
  it("preserves the public profile response", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const profiles = { getBySlug: vi.fn(async () => profile) };
    await app.register(publicProfilesRoutes, { profiles });

    const response = await app.inject({ method: "GET", url: "/profiles/ALICE" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(profile);
    expect(profiles.getBySlug).toHaveBeenCalledWith("ALICE");
  });

  it("resolves a historical Profile alias to its canonical profile identity", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const profiles = { getBySlug: vi.fn(async () => profile) };
    await app.register(publicProfilesRoutes, { profiles });

    const response = await app.inject({ method: "GET", url: "/identities/%20Alice-Publisher%20" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      subjectKind: "profile",
      requestedHandle: "alice-publisher",
      canonicalHandle: "alice",
      profile,
    });
    expect(profiles.getBySlug).toHaveBeenCalledWith("alice-publisher");
  });

  it("returns the established profile and identity not-found responses", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const profiles = { getBySlug: vi.fn(async () => null) };
    await app.register(publicProfilesRoutes, { profiles });

    const profileResponse = await app.inject({ method: "GET", url: "/profiles/missing" });
    expect(profileResponse.statusCode).toBe(404);
    expect(profileResponse.json()).toEqual({ error: "Profile not found" });
    const identity = await app.inject({ method: "GET", url: "/identities/missing" });
    expect(identity.statusCode).toBe(404);
    expect(identity.json()).toEqual({ error: "Identity not found" });
  });

  it("serves only active public Profile assets with immutable safe headers", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    app.decorate("mysql", {
      query: vi.fn(async () => [
        [
          {
            storageKey: "avatar/aa/00000000-0000-0000-0000-000000000000.png",
            originalFileName: "avatar.png",
            mimeType: "image/png",
            sha256: "a".repeat(64),
          },
        ],
        [],
      ]),
    });
    await app.register(publicProfileAssetRoutes, {
      store: {
        open: vi.fn(async () => ({ stream: Readable.from([Buffer.from("png")]), sizeBytes: 3 })),
      },
    });

    const response = await app.inject({ method: "GET", url: "/profile-assets/asset-1/content" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers.etag).toBe(`"${"a".repeat(64)}"`);
    expect(response.body).toBe("png");
  });

  it("does not resolve an empty alias", async () => {
    const profiles = { getBySlug: vi.fn(async () => profile) };
    const identities = createPublicIdentityPort(profiles);
    await expect(identities.resolveByHandle("   ")).resolves.toBeNull();
    expect(profiles.getBySlug).not.toHaveBeenCalled();
  });
});
