/**
 * Users API Routes
 */

import { FastifyInstance } from "fastify";

export async function usersRoutes(fastify: FastifyInstance) {
  const prisma = fastify.prisma;
  // 获取用户
  fastify.get<{ Params: { idOrHandle: string } }>("/:idOrHandle", async (request, reply) => {
    const { idOrHandle } = request.params;
    
    const user = await prisma.users.findFirst({
      where: {
        OR: [
          { id: idOrHandle },
          { handle: idOrHandle },
        ],
      },
      select: {
        id: true,
        handle: true,
        displayName: true,
        name: true,
        image: true,
        bio: true,
        role: true,
        trustedPublisher: true,
        publishedSkills: true,
        totalStars: true,
        totalDownloads: true,
        createdAt: true,
      },
    });
    
    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }
    
    return user;
  });
  
  // 获取用户的技能
  fastify.get<{ Params: { idOrHandle: string }, Querystring: { page?: string; limit?: string } }>(
    "/:idOrHandle/skills",
    async (request, reply) => {
      const { idOrHandle } = request.params;
      const { page = "1", limit = "20" } = request.query as any;
      
      const user = await prisma.users.findFirst({
        where: {
          OR: [{ id: idOrHandle }, { handle: idOrHandle }],
        },
      });
      
      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }
      
      const [skills, total] = await Promise.all([
        prisma.skills.findMany({
          where: {
            ownerUserId: user.id,
            softDeletedAt: null,
          },
          orderBy: { createdAt: "desc" },
          skip: (parseInt(page) - 1) * parseInt(limit),
          take: parseInt(limit),
        }),
        prisma.skills.count({
          where: { ownerUserId: user.id, softDeletedAt: null },
        }),
      ]);
      
      return {
        skills,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
        },
      };
    }
  );
  
  // 获取用户收藏的技能
  fastify.get<{ Params: { idOrHandle: string }, Querystring: { page?: string; limit?: string } }>(
    "/:idOrHandle/stars",
    async (request, reply) => {
      const { idOrHandle } = request.params;
      const { page = "1", limit = "20" } = request.query as any;
      
      const user = await prisma.users.findFirst({
        where: {
          OR: [{ id: idOrHandle }, { handle: idOrHandle }],
        },
      });
      
      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }
      
      const stars = await prisma.stars.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
        include: {
          skill: {
            include: {
              owner: {
                select: { id: true, handle: true, displayName: true, image: true },
              },
            },
          },
        },
      });
      
      return {
        skills: stars.map(s => s.skill),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
        },
      };
    }
  );
  
  // 更新用户资料
  fastify.put("/me", {
    onRequest: [fastify.authenticate],
  }, async (request: any, reply) => {
    const { displayName, bio, image } = request.body;
    
    const updated = await prisma.users.update({
      where: { id: request.user.id },
      data: { displayName, bio, image },
    });
    
    return {
      id: updated.id,
      handle: updated.handle,
      displayName: updated.displayName,
      bio: updated.bio,
      image: updated.image,
    };
  });
}
