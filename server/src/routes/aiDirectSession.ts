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

const featureFlags = (env: NodeJS.ProcessEnv = process.env): Record<string, boolean> => {
  const defaults = { aiDirectHiring: true, desktopIdentityBridge: true, wechatLogin: false };
  if (!env.AI_DIRECT_FEATURE_FLAGS) return defaults;
  try {
    const parsed = JSON.parse(env.AI_DIRECT_FEATURE_FLAGS) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries({ ...defaults, ...parsed }).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
      ),
    );
  } catch {
    return defaults;
  }
};

const requestedOrganizationId = (request: FastifyRequest): string | null => {
  const value = request.headers["x-organization-id"];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

export async function aiDirectSessionRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/session", { onRequest: [fastify.authenticate] }, async (request) => {
    const user = await requireAuth(fastify, request);
    const [rows] = await fastify.mysql.query<OrganizationRow[]>(
      `SELECT o.id, o.name, o.slug, m.role
       FROM ai_direct_organizations o
       JOIN ai_direct_organization_members m ON m.organizationId = o.id
       WHERE m.userId = ? AND m.status = 'active' AND o.status = 'active'
       ORDER BY o.updatedAt DESC
       LIMIT 100`,
      [user.id],
    );
    const organizations = rows.filter((row) => organizationRoles.includes(row.role));
    const requestedId = requestedOrganizationId(request);
    const current =
      organizations.find((organization) => organization.id === requestedId) ??
      organizations[0] ??
      null;

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
      organizations: organizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        role: organization.role,
        permissions: rolePermissions[organization.role],
      })),
      currentOrganization: current
        ? {
            id: current.id,
            name: current.name,
            slug: current.slug,
            role: current.role,
            permissions: rolePermissions[current.role],
          }
        : null,
      featureFlags: featureFlags(),
    };
  });
}
