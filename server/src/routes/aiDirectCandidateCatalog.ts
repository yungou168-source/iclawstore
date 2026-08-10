import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireAuth } from "../middleware/aiDirectAuth.js";
import { AiDirectHiringError, ErrorCodes, errorResponse } from "../services/aiDirectErrors.js";
import { decodeCatalogCursor, encodeCatalogCursor } from "../services/candidateCatalogDigest.js";
import { featureFlagsForOrganization } from "./aiDirectSession.js";

type Database = {
  query(sql: string, values?: unknown[]): Promise<[unknown]>;
};

type OrganizationRow = { id: string };

type CatalogRow = {
  agentId: string;
  agentVersionId: string;
  displayName: string;
  summary: string | null;
  categoryKey: string | null;
  capabilitySummary: unknown;
  appearanceAssetId: string | null;
  availability: string;
  priceStatus: string;
  isEmployed: number;
};

const asRows = <T>(value: unknown): T[] => value as T[];

const selectedOrganization = async (
  pool: Database,
  request: FastifyRequest,
  userId: string,
): Promise<string> => {
  const requested = request.headers["x-organization-id"];
  const organizationId =
    typeof requested === "string" && requested.trim() ? requested.trim() : null;
  const [result] = await pool.query(
    `SELECT o.id
     FROM ai_direct_organizations o
     JOIN ai_direct_organization_members m ON m.organizationId = o.id
     WHERE m.userId = ? AND m.status = 'active' AND o.status = 'active'
       ${organizationId ? "AND o.id = ?" : ""}
     ORDER BY o.updatedAt DESC LIMIT 1`,
    organizationId ? [userId, organizationId] : [userId],
  );
  const organization = asRows<OrganizationRow>(result)[0];
  if (!organization)
    throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, "当前用户没有可用组织目录权限", 403);
  if (featureFlagsForOrganization(organization.id).candidateCatalog !== true) {
    throw new AiDirectHiringError(ErrorCodes.RUNTIME_CAPABILITY_DISABLED, "候选目录尚未启用", 403);
  }
  return organization.id;
};

const parseLimit = (value: unknown): number => {
  const number = typeof value === "string" ? Number(value) : Number(value ?? 20);
  return Number.isInteger(number) && number >= 1 && number <= 50 ? number : 20;
};

const normalizeSearchTerms = (value: string): string | null => {
  const terms = value
    .trim()
    .toLocaleLowerCase("zh-CN")
    .split(/\s+/)
    .map((term) => term.replace(/[^\p{L}\p{N}_-]/gu, ""))
    .filter(Boolean)
    .slice(0, 8);
  return terms.length ? terms.map((term) => `+${term}*`).join(" ") : null;
};

const catalogItem = (item: CatalogRow) => ({
  agentId: item.agentId,
  agentVersionId: item.agentVersionId,
  displayName: item.displayName,
  summary: item.summary,
  category: item.categoryKey,
  capabilitySummary: item.capabilitySummary,
  appearanceAssetId: item.appearanceAssetId,
  availability: item.availability,
  priceStatus: item.priceStatus,
  viewerDisclosure: { isEmployedByCurrentOrganization: Boolean(item.isEmployed) },
});

export async function aiDirectCandidateCatalogRoutes(fastify: FastifyInstance): Promise<void> {
  const pool = (fastify as unknown as { mysql: Database }).mysql;

  fastify.get("/public/catalog/agents", async (request) => {
    const query = request.query as { limit?: string };
    const limit = parseLimit(query.limit);
    const [result] = await pool.query(
      `SELECT d.agentId, d.agentVersionId, d.displayName, d.summary, d.categoryKey,
              d.capabilitySummary, d.appearanceAssetId, d.availability, d.priceStatus,
              FALSE AS isEmployed
       FROM ai_direct_candidate_catalog_digests d
       JOIN ai_direct_agents a ON a.id = d.agentId
       WHERE d.availability = 'available' AND d.priceStatus = 'active'
         AND a.catalogVisibility = 'public'
       ORDER BY d.displayName ASC, d.agentId ASC LIMIT ?`,
      [limit],
    );
    return { items: asRows<CatalogRow>(result).map(catalogItem), nextCursor: null };
  });

  fastify.get("/public/users/:userId/agents", async (request) => {
    const { userId } = request.params as { userId: string };
    const [result] = await pool.query(
      `SELECT d.agentId, d.agentVersionId, d.displayName, d.summary, d.categoryKey,
              d.capabilitySummary, d.appearanceAssetId, d.availability, d.priceStatus,
              FALSE AS isEmployed
       FROM ai_direct_candidate_catalog_digests d
       JOIN ai_direct_agents a ON a.id = d.agentId
       WHERE a.ownerUserId = ? AND a.catalogVisibility = 'public'
         AND d.availability = 'available' AND d.priceStatus = 'active'
       ORDER BY d.displayName ASC, d.agentId ASC LIMIT 100`,
      [userId],
    );
    return { items: asRows<CatalogRow>(result).map(catalogItem) };
  });

  fastify.get("/catalog/agents", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    try {
      const user = await requireAuth(fastify, request);
      const organizationId = await selectedOrganization(pool, request, user.id);
      const query = request.query as {
        cursor?: string;
        category?: string;
        search?: string;
        limit?: string;
      };
      const cursor = decodeCatalogCursor(query.cursor);
      if (query.cursor && !cursor)
        throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "cursor 无效");
      const params: unknown[] = [organizationId];
      const filters = ["d.availability = 'available'"];
      if (query.category?.trim()) {
        filters.push("d.categoryKey = ?");
        params.push(query.category.trim());
      }
      if (query.search?.trim()) {
        const searchTerms = normalizeSearchTerms(query.search);
        if (!searchTerms)
          throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "search 不包含可查询字符");
        filters.push("MATCH(d.searchText) AGAINST (? IN BOOLEAN MODE)");
        params.push(searchTerms);
      }
      if (cursor) {
        filters.push("(d.displayName > ? OR (d.displayName = ? AND d.agentId > ?))");
        params.push(cursor.displayName, cursor.displayName, cursor.agentId);
      }
      const limit = parseLimit(query.limit);
      params.push(limit + 1);
      const [result] = await pool.query(
        `SELECT d.agentId, d.agentVersionId, d.displayName, d.summary, d.categoryKey,
                d.capabilitySummary, d.appearanceAssetId, d.availability, d.priceStatus,
                COALESCE(c.isEmployed, FALSE) AS isEmployed
         FROM ai_direct_candidate_catalog_digests d
         LEFT JOIN ai_direct_organization_candidate_catalog_counts c
           ON c.organizationId = ? AND c.agentId = d.agentId
         WHERE ${filters.join(" AND ")}
         ORDER BY d.displayName ASC, d.agentId ASC LIMIT ?`,
        params,
      );
      const records = asRows<CatalogRow>(result);
      const page = records.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map(catalogItem),
        nextCursor: records.length > limit && last ? encodeCatalogCursor(last) : null,
      };
    } catch (error) {
      if (error instanceof AiDirectHiringError)
        return reply.status(error.httpStatus).send(errorResponse(error));
      throw error;
    }
  });

  fastify.get(
    "/catalog/agents/:agentId",
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const user = await requireAuth(fastify, request);
        const organizationId = await selectedOrganization(pool, request, user.id);
        const { agentId } = request.params as { agentId: string };
        const [result] = await pool.query(
          `SELECT d.agentId, d.agentVersionId, d.displayName, d.summary, d.categoryKey,
                d.capabilitySummary, d.appearanceAssetId, d.availability, d.priceStatus,
                COALESCE(c.isEmployed, FALSE) AS isEmployed
         FROM ai_direct_candidate_catalog_digests d
         LEFT JOIN ai_direct_organization_candidate_catalog_counts c
           ON c.organizationId = ? AND c.agentId = d.agentId
         WHERE d.agentId = ? AND d.availability = 'available'
         LIMIT 1`,
          [organizationId, agentId],
        );
        const item = asRows<CatalogRow>(result)[0];
        if (!item)
          throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "候选 Agent 不存在或当前不可见", 404);
        return catalogItem(item);
      } catch (error) {
        if (error instanceof AiDirectHiringError)
          return reply.status(error.httpStatus).send(errorResponse(error));
        throw error;
      }
    },
  );

  fastify.get(
    "/catalog/categories",
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const user = await requireAuth(fastify, request);
        await selectedOrganization(pool, request, user.id);
        const [result] = await pool.query(
          `SELECT categoryKey, COUNT(*) AS candidateCount
         FROM ai_direct_candidate_catalog_digests
         WHERE availability = 'available' AND categoryKey IS NOT NULL
         GROUP BY categoryKey ORDER BY categoryKey ASC`,
        );
        return { items: result };
      } catch (error) {
        if (error instanceof AiDirectHiringError)
          return reply.status(error.httpStatus).send(errorResponse(error));
        throw error;
      }
    },
  );
}
