/**
 * Users API Routes
 */

import { FastifyInstance } from "fastify";
import { updateUserProfile } from "../services/userProfileService.js";

export async function usersRoutes(fastify: FastifyInstance) {
  type StarWithSkill = { skill: unknown };
  const prisma = fastify.prisma;
  // 获取用户
  fastify.get<{ Params: { idOrHandle: string } }>("/:idOrHandle", async (request, reply) => {
    const { idOrHandle } = request.params;

    const user = await prisma.users.findFirst({
      where: {
        OR: [{ id: idOrHandle }, { handle: idOrHandle }],
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
  fastify.get<{ Params: { idOrHandle: string }; Querystring: { page?: string; limit?: string } }>(
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
    },
  );

  // 获取用户收藏的技能
  fastify.get<{ Params: { idOrHandle: string }; Querystring: { page?: string; limit?: string } }>(
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
        skills: stars.map((s: StarWithSkill) => s.skill),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
        },
      };
    },
  );

  // 获取当前登录用户
  fastify.get(
    "/me",
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user?.id;
      if (!userId) {
        return reply.status(401).send({ code: "AUTH_REQUIRED", error: "Authentication required" });
      }
      const user = await prisma.users.findUnique({
        where: { id: userId },
        select: {
          id: true,
          handle: true,
          displayName: true,
          name: true,
          image: true,
          email: true,
          bio: true,
          role: true,
          trustedPublisher: true,
          publishedSkills: true,
          totalStars: true,
          totalDownloads: true,
          createdAt: true,
          deactivatedAt: true,
          deletedAt: true,
        },
      });
      if (!user || user.deactivatedAt || user.deletedAt) {
        return reply.status(401).send({ code: "AUTH_REQUIRED", error: "Account is no longer active" });
      }
      return user;
    },
  );

  fastify.post(
    "/me/logout",
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const authenticatedUser = request.user;
      if (!authenticatedUser?.sessionId) {
        return reply.status(401).send({ code: "AUTH_REQUIRED", error: "Session authentication required" });
      }
      await prisma.authSessions.updateMany({
        where: { id: authenticatedUser.sessionId, userId: authenticatedUser.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return reply.status(204).send();
    },
  );

  fastify.put(
    "/me",
    {
      onRequest: [fastify.authenticate],
    },
    async (request: any, reply) => {
      const updated = await updateUserProfile(prisma, request.user.id, request.body);

      return {
        id: updated.id,
        handle: updated.handle,
        displayName: updated.displayName,
        bio: updated.bio,
        image: updated.image,
      };
    },
  );

}
