import type { FastifyInstance } from "fastify";
import type { RowDataPacket } from "mysql2/promise";
import { createPublicIdentityPort, type PublicIdentityPort } from "../domains/identities/publicIdentityPort.js";
import { createPublicProfilePort } from "../domains/profiles/profilePortFactory.js";
import type { PublicProfilePort } from "../domains/profiles/publicProfilePort.js";
import type { ProfileReadObserver } from "../domains/profiles/profileReadObservability.js";
import {
  managedAssetDownloadHeaders,
  type ManagedAssetStore,
} from "../services/managedAssetStore.js";

const profileSchema = {
  type: "object",
  required: ["user", "profileSlug", "publisher"],
  additionalProperties: false,
  properties: {
    user: {
      type: "object",
      required: ["_id", "_creationTime"],
      additionalProperties: false,
      properties: {
        _id: { type: "string" },
        _creationTime: { type: "number" },
        handle: { type: "string" },
        name: { type: "string" },
        displayName: { type: "string" },
        image: { type: "string" },
        bio: { type: "string" },
      },
    },
    profileSlug: { type: "string" },
    publisher: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          required: ["handle", "displayName"],
          additionalProperties: false,
          properties: { handle: { type: "string" }, displayName: { type: "string" } },
        },
      ],
    },
  },
} as const;

const notFoundSchema = {
  type: "object",
  required: ["error"],
  additionalProperties: false,
  properties: { error: { type: "string" } },
} as const;

const publicIdentitySchema = {
  type: "object",
  required: ["subjectKind", "requestedHandle", "canonicalHandle", "profile"],
  additionalProperties: false,
  properties: {
    subjectKind: { const: "profile" },
    requestedHandle: { type: "string" },
    canonicalHandle: { type: "string" },
    profile: profileSchema,
  },
} as const;

export async function publicProfilesRoutes(
  fastify: FastifyInstance,
  options: Readonly<{
    observer?: ProfileReadObserver;
    profiles?: PublicProfilePort;
    identities?: PublicIdentityPort;
  }>,
): Promise<void> {
  const profiles =
    options.profiles ??
    createPublicProfilePort({
      mysql: process.env.DATABASE_URL?.startsWith("mysql") ? fastify.mysql : undefined,
      observer: options.observer,
    });
  const identities = options.identities ?? createPublicIdentityPort(profiles);

  fastify.get<{ Params: { slug: string } }>("/profiles/:slug", {
    schema: {
      params: {
        type: "object",
        required: ["slug"],
        properties: { slug: { type: "string", minLength: 1 } },
      },
      response: { 200: profileSchema, 404: notFoundSchema },
    },
    handler: async (request, reply) => {
      const profile = await profiles.getBySlug(request.params.slug);
      if (!profile) return reply.status(404).send({ error: "Profile not found" });
      return reply.send(profile);
    },
  });

  fastify.get<{ Params: { handle: string } }>("/identities/:handle", {
    schema: {
      params: {
        type: "object",
        required: ["handle"],
        properties: { handle: { type: "string", minLength: 1 } },
      },
      response: { 200: publicIdentitySchema, 404: notFoundSchema },
    },
    handler: async (request, reply) => {
      const identity = await identities.resolveByHandle(request.params.handle);
      if (!identity) return reply.status(404).send({ error: "Identity not found" });
      return reply.send(identity);
    },
  });
}

type ProfileAssetRow = RowDataPacket & {
  storageKey: string;
  originalFileName: string | null;
  mimeType: string;
  sha256: string;
};

export async function publicProfileAssetRoutes(
  fastify: FastifyInstance,
  options: Readonly<{ store: Pick<ManagedAssetStore, "open"> }>,
): Promise<void> {
  fastify.get<{ Params: { assetId: string } }>("/profile-assets/:assetId/content", {
    schema: {
      params: {
        type: "object",
        required: ["assetId"],
        properties: { assetId: { type: "string", minLength: 1 } },
      },
      response: { 404: notFoundSchema },
    },
    handler: async (request, reply) => {
      const [rows] = await fastify.mysql.query<ProfileAssetRow[]>(
        `SELECT storageKey, originalFileName, mimeType, sha256
         FROM convex_exit_managed_assets
         WHERE id = ? AND ownerDomain = 'profiles' AND accessScope = 'public' AND status = 'active'
         LIMIT 1`,
        [request.params.assetId],
      );
      const asset = rows[0];
      if (!asset) return reply.status(404).send({ error: "Profile asset not found" });
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
