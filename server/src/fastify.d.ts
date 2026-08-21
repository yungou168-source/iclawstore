import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "mysql2/promise";
import type { PrismaClient } from '@prisma/client';
import type { AuthenticatedUser } from "./middleware/aiDirectAuth.js";

declare module "fastify" {
  interface FastifyRequest {
    user: AuthenticatedUser | null;
  }

  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply?: FastifyReply): Promise<void>;
    prisma: PrismaClient;
    mysql: Pool;
  }
}
