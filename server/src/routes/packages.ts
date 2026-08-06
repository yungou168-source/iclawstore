/**
 * Packages API Routes
 */

import { FastifyInstance } from "fastify";
import { prisma } from "../index.js";

export async function packagesRoutes(fastify: FastifyInstance) {
  // 获取所有包
  fastify.get("/", async (request, reply) => {
    const {
      page = "1",
      limit = "20",
      family,
      channel,
      official,
      sort = "stats_downloads",
    } = request.query as any;
    
    const where: any = { softDeletedAt: null };
    
    if (family) where.family = family;
    if (channel) where.channel = channel;
    if (official !== undefined) where.isOfficial = official === "true";
    
    const orderBy: any = {};
    switch (sort) {
      case "downloads": orderBy.stats = { path: ["downloads"], order: "desc" }; break;
      case "installs": orderBy.stats = { path: ["installs"], order: "desc" }; break;
      case "created": orderBy.createdAt = "desc"; break;
      default: orderBy.stats = { path: ["downloads"], order: "desc" };
    }
    
    const [packages, total] = await Promise.all([
      prisma.packages.findMany({
        where,
        orderBy,
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.packages.count({ where }),
    ]);
    
    return {
      packages,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    };
  });
  
  // 获取单个包
  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { id } = request.params;
    
    const pkg = await prisma.packages.findUnique({
      where: { id },
      include: {
        releases: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
    });
    
    if (!pkg) {
      return reply.status(404).send({ error: "Package not found" });
    }
    
    return pkg;
  });
}
