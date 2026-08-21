import type { FastifyInstance } from "fastify";
import type { RowDataPacket } from "mysql2/promise";
import type {
  PublicPublisherMembers,
  PublicPublisherPage,
  PublicPublisherPort,
  PublisherDirectoryQuery,
  PublisherKind,
} from "../domains/publishers/publicPublisherPort.js";
import { createPublicPublisherPort } from "../domains/publishers/publisherPortFactory.js";
import type { PublisherReadObserver } from "../domains/publishers/publisherReadObservability.js";
import {
  managedAssetDownloadHeaders,
  type ManagedAssetStore,
} from "../services/managedAssetStore.js";

const publicPublisherSchema = {
  type: "object",
  required: ["_id", "_creationTime", "kind", "handle", "displayName"],
  additionalProperties: true,
  properties: {
    _id: { type: "string" },
    _creationTime: { type: "number" },
    kind: { enum: ["user", "org"] },
    handle: { type: "string" },
    displayName: { type: "string" },
    image: { anyOf: [{ type: "string" }, { type: "null" }] },
    bio: { anyOf: [{ type: "string" }, { type: "null" }] },
    linkedUserId: { anyOf: [{ type: "string" }, { type: "null" }] },
    official: { type: "boolean" },
  },
} as const;

const publisherSchema = {
  ...publicPublisherSchema,
  required: ["_id", "_creationTime", "kind", "handle", "displayName", "stats", "publishedItems"],
  properties: {
    ...publicPublisherSchema.properties,
    stats: {
      type: "object",
      required: ["skills", "packages", "installs", "downloads", "stars"],
      additionalProperties: false,
      properties: {
        skills: { type: "number" },
        packages: { type: "number" },
        installs: { type: "number" },
        downloads: { type: "number" },
        stars: { type: "number" },
      },
    },
    publishedItems: { type: "array" },
  },
} as const;

const publisherPageSchema = {
  type: "object",
  required: ["page", "counts", "continueCursor", "isDone"],
  additionalProperties: false,
  properties: {
    page: { type: "array", items: publisherSchema },
    counts: {
      type: "object",
      required: ["all", "organizations", "individuals"],
      additionalProperties: false,
      properties: {
        all: { type: "number" },
        organizations: { type: "number" },
        individuals: { type: "number" },
      },
    },
    globalCounts: {
      type: "object",
      required: ["all", "organizations", "individuals"],
      additionalProperties: false,
      properties: {
        all: { type: "number" },
        organizations: { type: "number" },
        individuals: { type: "number" },
      },
    },
    continueCursor: { type: "string" },
    isDone: { type: "boolean" },
  },
} as const;

const publisherMemberSchema = {
  type: "object",
  required: ["role", "user"],
  additionalProperties: false,
  properties: {
    role: { enum: ["owner", "admin", "publisher"] },
    user: {
      type: "object",
      required: ["_id", "handle", "displayName", "image", "official"],
      additionalProperties: false,
      properties: {
        _id: { type: "string" },
        handle: { anyOf: [{ type: "string" }, { type: "null" }] },
        displayName: { anyOf: [{ type: "string" }, { type: "null" }] },
        image: { anyOf: [{ type: "string" }, { type: "null" }] },
        official: { type: "boolean" },
      },
    },
  },
} as const;

const publisherMembersSchema = {
  type: "object",
  required: ["publisher", "members"],
  additionalProperties: false,
  properties: {
    publisher: { anyOf: [{ type: "null" }, publicPublisherSchema] },
    members: { type: "array", items: publisherMemberSchema },
  },
} as const;

const notFoundSchema = {
  type: "object",
  required: ["error"],
  additionalProperties: false,
  properties: { error: { type: "string" } },
} as const;

const parseKind = (value: unknown): PublisherKind | undefined => {
  if (value === "org" || value === "orgs") return "org";
  if (value === "user" || value === "users" || value === "builders" || value === "individuals") {
    return "user";
  }
  return undefined;
};

const parseLimit = (value: unknown): number => {
  const parsed = Number(value ?? 25);
  if (!Number.isFinite(parsed)) return 25;
  return Math.min(Math.max(Math.trunc(parsed), 1), 100);
};

const directoryQueryFromRequest = (query: {
  kind?: unknown;
  q?: unknown;
  query?: unknown;
  cursor?: unknown;
  limit?: unknown;
  numItems?: unknown;
}): PublisherDirectoryQuery => ({
  kind: parseKind(query.kind),
  query:
    typeof query.q === "string" && query.q.trim()
      ? query.q
      : typeof query.query === "string" && query.query.trim()
        ? query.query
        : undefined,
  paginationOpts: {
    cursor: typeof query.cursor === "string" && query.cursor ? query.cursor : null,
    numItems: parseLimit(query.numItems ?? query.limit),
  },
});

export async function publicPublishersRoutes(
  fastify: FastifyInstance,
  options: Readonly<{
    observer?: PublisherReadObserver;
    publishers?: PublicPublisherPort;
  }>,
): Promise<void> {
  const publishers =
    options.publishers ??
    createPublicPublisherPort({
      mysql: process.env.DATABASE_URL?.startsWith("mysql") ? fastify.mysql : undefined,
      observer: options.observer,
    });

  fastify.get<{ Querystring: Parameters<typeof directoryQueryFromRequest>[0] }>("/publishers", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: true,
        properties: {
          kind: { type: "string" },
          q: { type: "string" },
          query: { type: "string" },
          cursor: { type: "string" },
          limit: { type: "number" },
          numItems: { type: "number" },
        },
      },
      response: { 200: publisherPageSchema },
    },
    handler: async (request): Promise<PublicPublisherPage> =>
      publishers.listPublicPage(directoryQueryFromRequest(request.query)),
  });

  fastify.get<{ Params: { handle: string } }>("/publishers/:handle", {
    schema: {
      params: {
        type: "object",
        required: ["handle"],
        properties: { handle: { type: "string", minLength: 1 } },
      },
      response: { 200: publisherSchema, 404: notFoundSchema },
    },
    handler: async (request, reply) => {
      const publisher = await publishers.getProfileByHandle(request.params.handle);
      if (!publisher) return reply.status(404).send({ error: "Publisher not found" });
      return reply.send(publisher);
    },
  });

  fastify.get<{ Params: { handle: string } }>("/publishers/:handle/members", {
    schema: {
      params: {
        type: "object",
        required: ["handle"],
        properties: { handle: { type: "string", minLength: 1 } },
      },
      response: { 200: publisherMembersSchema, 404: notFoundSchema },
    },
    handler: async (request, reply) => {
      const members = await publishers.listMembers(request.params.handle);
      if (!members) return reply.status(404).send({ error: "Publisher not found" });
      return reply.send(members satisfies PublicPublisherMembers);
    },
  });
}

type PublisherAssetRow = RowDataPacket & {
  storageKey: string;
  originalFileName: string | null;
  mimeType: string;
  sha256: string;
};

export async function publicPublisherAssetRoutes(
  fastify: FastifyInstance,
  options: Readonly<{ store: Pick<ManagedAssetStore, "open"> }>,
): Promise<void> {
  fastify.get<{ Params: { assetId: string } }>("/publisher-assets/:assetId/content", {
    schema: {
      params: {
        type: "object",
        required: ["assetId"],
        properties: { assetId: { type: "string", minLength: 1 } },
      },
      response: { 404: notFoundSchema },
    },
    handler: async (request, reply) => {
      const [rows] = await fastify.mysql.query<PublisherAssetRow[]>(
        `SELECT storageKey, originalFileName, mimeType, sha256
         FROM convex_exit_managed_assets
         WHERE id = ? AND ownerDomain = 'publishers' AND accessScope = 'public' AND status = 'active'
         LIMIT 1`,
        [request.params.assetId],
      );
      const asset = rows[0];
      if (!asset) return reply.status(404).send({ error: "Publisher asset not found" });
      const opened = await options.store.open(asset.storageKey);
      const headers = managedAssetDownloadHeaders({
        mimeType: asset.mimeType,
        sha256: asset.sha256,
        originalFileName: asset.originalFileName ?? undefined,
      });
      for (const [name, value] of Object.entries(headers)) reply.header(name, value);
      reply.header("Content-Length", opened.sizeBytes);
      return reply.send(opened.stream);
    },
  });
}
