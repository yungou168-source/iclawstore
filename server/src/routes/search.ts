/**
 * Search API Routes (Meilisearch)
 */

import { FastifyInstance } from "fastify";
import { meili } from "../index.js";

export async function searchRoutes(fastify: FastifyInstance) {
  const SKILLS_INDEX = "skills";
  
  // 初始化索引设置
  async function initIndex() {
    try {
      const index = meili.index(SKILLS_INDEX);
      
      // 设置可搜索属性
      await index.updateSearchableAttributes([
        "displayName",
        "slug",
        "summary",
        "ownerHandle",
        "ownerName",
        "tags",
      ]);
      
      // 设置过滤属性
      await index.updateFilterableAttributes([
        "softDeletedAt",
        "isSuspicious",
        "ownerId",
        "publisherId",
      ]);
      
      // 设置排序属性
      await index.updateSortableAttributes([
        "statsDownloads",
        "statsStars",
        "statsInstallsAllTime",
        "createdAt",
      ]);
      
      console.log("Meilisearch index initialized");
    } catch (error) {
      console.error("Failed to init Meilisearch index:", error);
    }
  }
  
  // 搜索技能
  fastify.get("/", async (request, reply) => {
    const {
      q = "",
      page = "1",
      limit = "20",
      sort = "statsDownloads:desc",
    } = request.query as any;
    
    try {
      const index = meili.index(SKILLS_INDEX);
      
      const results = await index.search(q, {
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit),
        sort: sort.split(","),
        filter: "softDeletedAt IS NULL",
      });
      
      return {
        hits: results.hits,
        query: q,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: results.estimatedTotalHits || 0,
          pages: Math.ceil((results.estimatedTotalHits || 0) / parseInt(limit)),
        },
        processingTimeMs: results.processingTimeMs,
      };
    } catch (error: any) {
      // 如果索引不存在，返回空结果
      if (error.code === "index_not_found") {
        await initIndex();
        return {
          hits: [],
          query: q,
          pagination: { page: 1, limit: 20, total: 0, pages: 0 },
          processingTimeMs: 0,
        };
      }
      throw error;
    }
  });
  
  // 获取搜索建议
  fastify.get("/suggestions", async (request, reply) => {
    const { q = "" } = request.query as any;
    
    if (!q || q.length < 2) {
      return { suggestions: [] };
    }
    
    try {
      const index = meili.index(SKILLS_INDEX);
      
      const results = await index.search(q, {
        limit: 5,
        attributesToRetrieve: ["id", "displayName", "slug", "icon"],
      });
      
      return {
        suggestions: results.hits.map((hit: any) => ({
          id: hit.id,
          displayName: hit.displayName,
          slug: hit.slug,
          icon: hit.icon,
        })),
      };
    } catch {
      return { suggestions: [] };
    }
  });
}
