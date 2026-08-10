import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RowDataPacket } from "mysql2/promise";
import { requireAuth } from "../middleware/aiDirectAuth.js";

const organizationRoles = ["owner", "admin", "manager", "member"] as const;
type OrganizationRole = (typeof organizationRoles)[number];

type OrganizationRow = RowDataPacket & {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
  membershipUpdatedAt: Date | string;
};

type FeatureFlags = Record<string, boolean>;

type FeatureFlagConfig = {
  defaults: FeatureFlags;
  organizations: Record<string, FeatureFlags>;
};

const baseFeatureFlags: FeatureFlags = {
  aiDirectHiring: true,
  desktopIdentityBridge: true,
  wechatLogin: false,
  desktopJobs: true,
  candidateCatalog: false,
  interviews: false,
  providerExecution: false,
};

const rolePermissions: Record<OrganizationRole, string[]> = {
  owner: [
    "organization:read",
    "organization:manage",
    "company:manage",
    "hiring:manage",
    "billing:manage",
  ],
  admin: ["organization:read", "organization:manage", "company:manage", "hiring:manage"],
  manager: ["organization:read", "company:read", "hiring:manage"],
  member: ["organization:read", "company:read", "hiring:read"],
};

function booleanEntries(value: unknown): FeatureFlags {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
    ),
  );
}

export function featureFlagConfigFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): FeatureFlagConfig {
  if (!env.AI_DIRECT_FEATURE_FLAGS) {
    return { defaults: baseFeatureFlags, organizations: {} };
  }
  try {
    const parsed = JSON.parse(env.AI_DIRECT_FEATURE_FLAGS) as unknown;
    const object =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const nested = "defaults" in object || "organizations" in object;
    const defaults = {
      ...baseFeatureFlags,
      ...booleanEntries(nested ? object.defaults : object),
    };
    const organizations = Object.fromEntries(
      Object.entries(booleanEntriesByKey(object.organizations)).map(([organizationId, flags]) => [
        organizationId,
        { ...defaults, ...flags },
      ]),
    );
    return { defaults, organizations };
  } catch {
    return { defaults: baseFeatureFlags, organizations: {} };
  }
}

function booleanEntriesByKey(value: unknown): Record<string, FeatureFlags> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([organizationId, flags]) => [organizationId, booleanEntries(flags)]),
  );
}

export function featureFlagsForOrganization(
  organizationId: string | null,
  config: FeatureFlagConfig = featureFlagConfigFromEnvironment(),
): FeatureFlags {
  return {
    ...config.defaults,
    ...(organizationId ? config.organizations[organizationId] : {}),
  };
}

function runtimeCapabilities(
  flags: FeatureFlags,
  env: NodeJS.ProcessEnv = process.env,
): FeatureFlags {
  const executorEnabled = env.PROVIDER_EXECUTION_ENABLED === "true";
  const artifactDownloadEnabled = Boolean(env.AI_DIRECT_ARTIFACT_ROOT?.trim());
  return {
    desktopJobs: flags.desktopJobs === true,
    artifactDownload: flags.desktopJobs === true && artifactDownloadEnabled,
    candidateCatalog: flags.candidateCatalog === true,
    interviews: flags.interviews === true,
    providerExecution: flags.providerExecution === true && executorEnabled,
  };
}

function grantVersion(organization: OrganizationRow): string {
  const updatedAt =
    organization.membershipUpdatedAt instanceof Date
      ? organization.membershipUpdatedAt.toISOString()
      : String(organization.membershipUpdatedAt);
  return createHash("sha256")
    .update(`${organization.id}\0${organization.role}\0${updatedAt}`)
    .digest("base64url")
    .slice(0, 22);
}

const requestedOrganizationId = (request: FastifyRequest): string | null => {
  const value = request.headers["x-organization-id"];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

export async function aiDirectSessionRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/session", { onRequest: [fastify.authenticate] }, async (request) => {
    const user = await requireAuth(fastify, request);
    const [rows] = await fastify.mysql.query<OrganizationRow[]>(
      `SELECT o.id, o.name, o.slug, m.role, m.updatedAt AS membershipUpdatedAt
       FROM ai_direct_organizations o
       JOIN ai_direct_organization_members m ON m.organizationId = o.id
       WHERE m.userId = ? AND m.status = 'active' AND o.status = 'active'
       ORDER BY o.updatedAt DESC
       LIMIT 100`,
      [user.id],
    );
    const organizations = rows.filter((row) => organizationRoles.includes(row.role));
    const requestedId = requestedOrganizationId(request);
    const selected =
      organizations.find((organization) => organization.id === requestedId) ??
      organizations[0] ??
      null;
    const flags = featureFlagsForOrganization(selected?.id ?? null);
    const organizationDto = (organization: OrganizationRow) => ({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: organization.role,
      permissions: rolePermissions[organization.role],
      grantVersion: grantVersion(organization),
    });

    return {
      user: {
        id: user.id,
        convexUserId: user.convexUserId,
        email: user.email ?? null,
        name: user.name ?? null,
        handle: user.handle ?? null,
        displayName: user.displayName ?? null,
        image: user.image ?? null,
        role: user.role ?? "user",
      },
      organizations: organizations.map(organizationDto),
      currentOrganization: selected ? organizationDto(selected) : null,
      organizationSelection: {
        requestedOrganizationId: requestedId,
        resolvedOrganizationId: selected?.id ?? null,
        source: requestedId === selected?.id ? "requested" : "default",
      },
      featureFlags: flags,
      runtimeCapabilities: runtimeCapabilities(flags),
    };
  });
}
