/**
 * Skills API Routes
 */

import { FastifyInstance } from "fastify";

export async function skillsRoutes(fastify: FastifyInstance) {
  const prisma = fastify.prisma;
  // 获取所有技能
  fastify.get("/", async (request, reply) => {
    const { page = "1", limit = "20", sort = "downloads" } = request.query as any;
    
    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 100);
    const skip = (pageNum - 1) * limitNum;
    
    const orderBy: any = {};
    switch (sort) {
      case "downloads": orderBy.statsDownloads = "desc"; break;
      case "stars": orderBy.statsStars = "desc"; break;
      case "installs": orderBy.statsInstallsAllTime = "desc"; break;
      case "created": orderBy.createdAt = "desc"; break;
      default: orderBy.statsDownloads = "desc";
    }
    
    const [skills, total] = await Promise.all([
      prisma.skills.findMany({
        where: {
          softDeletedAt: null,
        },
        orderBy,
        skip,
        take: limitNum,
        include: {
          owner: {
            select: {
              id: true,
              handle: true,
              displayName: true,
              image: true,
            },
          },
          publisher: {
            select: {
              id: true,
              handle: true,
              displayName: true,
              image: true,
            },
          },
        },
      }),
      prisma.skills.count({ where: { softDeletedAt: null } }),
    ]);
    
    return {
      skills,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    };
  });
  
  // 获取单个技能
  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { id } = request.params;
    
    const skill = await prisma.skills.findUnique({
      where: { id },
      include: {
        owner: {
          select: {
            id: true,
            handle: true,
            displayName: true,
            image: true,
          },
        },
        publisher: {
          select: {
            id: true,
            handle: true,
            displayName: true,
            image: true,
          },
        },
        versions: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
        comments: {
          where: { softDeletedAt: null },
          include: {
            user: {
              select: { id: true, handle: true, displayName: true, image: true },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    });
    
    if (!skill) {
      return reply.status(404).send({ error: "Skill not found" });
    }
    
    // 获取收藏数
    const starsCount = await prisma.stars.count({ where: { skillId: id } });
    
    return { ...skill, starsCount };
  });
  
  // 创建技能 (需要认证)
  fastify.post("/", {
    onRequest: [fastify.authenticate],
  }, async (request: any, reply) => {
    const { slug, displayName, summary, githubSourceId, githubPath } = request.body;
    
    // 检查 slug 是否可用
    const existing = await prisma.skills.findFirst({
      where: { ownerUserId: request.user.id, slug },
    });
    
    if (existing) {
      return reply.status(400).send({ error: "Slug already in use" });
    }
    
    const skill = await prisma.skills.create({
      data: {
        slug,
        displayName,
        summary,
        ownerUserId: request.user.id,
        githubSourceId,
        githubPath,
      },
    });
    
    return skill;
  });
  
  // 更新技能
  fastify.put<{ Params: { id: string } }>("/:id", {
    onRequest: [fastify.authenticate],
  }, async (request: any, reply) => {
    const { id } = request.params;
    const { displayName, summary, icon } = request.body;
    
    // 检查所有权
    const skill = await prisma.skills.findUnique({ where: { id } });
    
    if (!skill) {
      return reply.status(404).send({ error: "Skill not found" });
    }
    
    if (skill.ownerUserId !== request.user.id) {
      return reply.status(403).send({ error: "Not authorized" });
    }
    
    const updated = await prisma.skills.update({
      where: { id },
      data: { displayName, summary, icon },
    });
    
    return updated;
  });
  
  // 删除技能 (软删除)
  fastify.delete<{ Params: { id: string } }>("/:id", {
    onRequest: [fastify.authenticate],
  }, async (request: any, reply) => {
    const { id } = request.params;
    
    const skill = await prisma.skills.findUnique({ where: { id } });
    
    if (!skill) {
      return reply.status(404).send({ error: "Skill not found" });
    }
    
    if (skill.ownerUserId !== request.user.id) {
      return reply.status(403).send({ error: "Not authorized" });
    }
    
    await prisma.skills.update({
      where: { id },
      data: { softDeletedAt: new Date() },
    });
    
    return { success: true };
  });
  
  // 收藏/取消收藏
  fastify.post<{ Params: { id: string } }>("/:id/star", {
    onRequest: [fastify.authenticate],
  }, async (request: any, reply) => {
    const { id } = request.params;
    const userId = request.user.id;
    
    const existing = await prisma.stars.findUnique({
      where: { skillId_userId: { skillId: id, userId } },
    });
    
    if (existing) {
      // 取消收藏
      await prisma.stars.delete({
        where: { skillId_userId: { skillId: id, userId } },
      });
      
      // 更新统计
      await prisma.skills.update({
        where: { id },
        data: { statsStars: { decrement: 1 } },
      });
      
      return { starred: false };
    } else {
      // 添加收藏
      await prisma.stars.create({
        data: { skillId: id, userId },
      });
      
      // 更新统计
      await prisma.skills.update({
        where: { id },
        data: { statsStars: { increment: 1 } },
      });
      
      return { starred: true };
    }
  });
  
  // 获取技能版本
  fastify.get<{ Params: { id: string }, Querystring: { page?: string; limit?: string } }>(
    "/:id/versions",
    async (request, reply) => {
      const { id } = request.params;
      const { page = "1", limit = "20" } = request.query as any;
      
      const [versions, total] = await Promise.all([
        prisma.skillVersions.findMany({
          where: { skillId: id },
          orderBy: { createdAt: "desc" },
          skip: (parseInt(page) - 1) * parseInt(limit),
          take: parseInt(limit),
        }),
        prisma.skillVersions.count({ where: { skillId: id } }),
      ]);
      
      return {
        versions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
        },
      };
    }
  );
}
