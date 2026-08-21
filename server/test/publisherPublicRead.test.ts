import { describe, expect, it, vi } from "bun:test";
import {
  comparePublicPublishers,
  createComparePublicPublisherAdapter,
} from "../src/domains/publishers/comparePublicPublisherAdapter.js";
import { createMysqlPublicPublisherAdapter } from "../src/domains/publishers/mysqlPublicPublisherAdapter.js";
import type { PublicPublisherListItem } from "../src/domains/publishers/publicPublisherPort.js";
import { createPublisherReadObserver } from "../src/domains/publishers/publisherReadObservability.js";

const publisher = (overrides: Partial<PublicPublisherListItem> = {}): PublicPublisherListItem => ({
  _id: "publishers:acme",
  _creationTime: 1,
  kind: "org",
  handle: "acme",
  displayName: "Acme",
  image: null,
  bio: "Builds tools",
  linkedUserId: null,
  official: true,
  stats: { skills: 2, packages: 1, installs: 10, downloads: 20, stars: 3 },
  publishedItems: [],
  ...overrides,
});

describe("Publisher public read adapters", () => {
  it("hydrates public Publisher details from candidate snapshots", async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      expect(sql).toContain("publisher_snapshots");
      expect(values).toEqual(["acme"]);
      return [
        [
          {
            legacyConvexId: "publishers:acme",
            legacyCreationTime: 123,
            kind: "org",
            handle: "acme",
            displayName: "Acme",
            bio: "Builds tools",
            sourceImageUrl: "https://cdn.example/acme.png",
            linkedUserLegacyConvexId: null,
            trustedPublisher: 0,
            publishedSkills: 2,
            publishedPackages: 1,
            totalInstalls: 10,
            totalDownloads: 20,
            totalStars: 3,
            skillTotalInstalls: 10,
            skillTotalDownloads: 20,
            skillTotalStars: 3,
            officialId: "official:acme",
            publisherTargetAssetId: "asset-org",
            profileTargetAssetId: null,
          },
        ],
        [],
      ];
    });
    const adapter = createMysqlPublicPublisherAdapter({ query } as never);
    await expect(adapter.getProfileByHandle("@Acme")).resolves.toMatchObject({
      _id: "publishers:acme",
      handle: "acme",
      kind: "org",
      image: "/api/publisher-assets/asset-org/content",
      official: true,
      stats: { skills: 2, packages: 1, installs: 10, downloads: 20, stars: 3 },
    });
  });

  it("returns candidate directory pages with counts and offset cursor", async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("ORDER BY p.totalDownloads")) {
        expect(values).toEqual(["org", "%acme%", "%acme%", "%acme%", 2, 0]);
        return [
          [
            {
              legacyConvexId: "publishers:acme",
              legacyCreationTime: 123,
              kind: "org",
              handle: "acme",
              displayName: "Acme",
              bio: null,
              sourceImageUrl: null,
              linkedUserLegacyConvexId: null,
              trustedPublisher: 0,
              publishedSkills: 1,
              publishedPackages: 0,
              totalInstalls: 1,
              totalDownloads: 2,
              totalStars: 3,
              skillTotalInstalls: 1,
              skillTotalDownloads: 2,
              skillTotalStars: 3,
              officialId: null,
              publisherTargetAssetId: null,
              profileTargetAssetId: null,
            },
          ],
          [],
        ];
      }
      return [[{ allCount: 1, organizationCount: 1, individualCount: 0 }], []];
    });
    const adapter = createMysqlPublicPublisherAdapter({ query } as never);
    const page = await adapter.listPublicPage({
      kind: "org",
      query: "acme",
      paginationOpts: { cursor: null, numItems: 2 },
    });
    expect(page).toMatchObject({
      counts: { all: 1, organizations: 1, individuals: 0 },
      continueCursor: "",
      isDone: true,
    });
    expect(page.page[0]?.handle).toBe("acme");
  });

  it("hydrates public Publisher members from candidate snapshots", async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("LIMIT 1")) {
        expect(values).toEqual(["acme"]);
        return [
          [
            {
              id: "publisher-snapshot-acme",
              legacyConvexId: "publishers:acme",
              legacyCreationTime: 123,
              kind: "org",
              handle: "acme",
              displayName: "Acme",
              bio: null,
              sourceImageUrl: null,
              linkedUserLegacyConvexId: null,
              trustedPublisher: 0,
              publishedSkills: 1,
              publishedPackages: 0,
              totalInstalls: 1,
              totalDownloads: 2,
              totalStars: 3,
              skillTotalInstalls: 1,
              skillTotalDownloads: 2,
              skillTotalStars: 3,
              officialId: null,
              publisherTargetAssetId: null,
              profileTargetAssetId: null,
            },
          ],
          [],
        ];
      }
      expect(sql).toContain("publisher_member_snapshots");
      expect(values).toEqual(["publisher-snapshot-acme"]);
      return [
        [
          {
            memberUserLegacyConvexId: "users:alice",
            role: "owner",
            handle: "alice",
            profileSlug: "alice",
            name: "Alice A",
            displayName: "Alice",
            image: "https://cdn.example/alice.png",
            profileTargetAssetId: "profile-asset",
            officialId: "official:alice",
          },
        ],
        [],
      ];
    });
    const adapter = createMysqlPublicPublisherAdapter({ query } as never);

    await expect(adapter.listMembers("@Acme")).resolves.toEqual({
      publisher: expect.objectContaining({ _id: "publishers:acme", handle: "acme" }),
      members: [
        {
          role: "owner",
          user: {
            _id: "users:alice",
            handle: "alice",
            displayName: "Alice",
            image: "/api/profile-assets/profile-asset/content",
            official: true,
          },
        },
      ],
    });
  });

  it("compares stable public Publisher fields and records differences without changing source reads", async () => {
    const differences = comparePublicPublishers(
      publisher(),
      publisher({
        displayName: "ACME",
        stats: { skills: 1, packages: 1, installs: 10, downloads: 20, stars: 3 },
      }),
    );
    expect(differences.map((difference) => difference.fieldName)).toEqual([
      "displayName",
      "stats.skills",
    ]);

    const source = { getProfileByHandle: vi.fn(async () => publisher()), listPublicPage: vi.fn() };
    const target = {
      getProfileByHandle: vi.fn(async () => publisher({ displayName: "ACME" })),
      listPublicPage: vi.fn(),
    };
    const sink = { record: vi.fn(async () => undefined) };
    const observer = createPublisherReadObserver();
    const adapter = createComparePublicPublisherAdapter(
      source as never,
      target as never,
      sink,
      console,
      observer,
    );
    await expect(adapter.getProfileByHandle("acme")).resolves.toEqual(publisher());
    expect(sink.record).toHaveBeenCalledWith([
      {
        stableId: "publishers:acme",
        fieldName: "displayName",
        differenceKind: "value_mismatch",
        summary: "displayName differs",
      },
    ]);
    expect(observer.snapshot()).toMatchObject({ mysqlHit: 1, diff: 1 });
  });

});
