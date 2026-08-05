import { FastifyInstance, FastifyRequest } from "fastify";
import { AiDirectHiringError, ErrorCodes } from "../services/aiDirectErrors.js";

/**
 * AI Direct Hiring auth middleware.
 * Reuses the Fastify `authenticate` hook attached to the app instance.
 * Throws an error (not a reply) so callers can decide how to respond.
 */
export class AuthRequiredError extends AiDirectHiringError {
  constructor(message = "Authentication required") {
    super(ErrorCodes.AUTH_REQUIRED, message, 401);
    this.name = "AuthRequiredError";
  }
}

export class ForbiddenScopeError extends AiDirectHiringError {
  constructor(message = "Forbidden: insufficient scope") {
    super(ErrorCodes.FORBIDDEN_SCOPE, message, 403);
    this.name = "ForbiddenScopeError";
  }
}

export interface AuthenticatedUser {
  id: string;
  convexUserId?: string;
  issuer?: string;
  subject?: string;
  authSource?: "convex";
  role?: string;
  email?: string;
  name?: string;
  handle?: string;
  displayName?: string;
  image?: string;
}

export async function requireAuth(
  fastify: FastifyInstance,
  request: FastifyRequest,
): Promise<AuthenticatedUser> {
  if (!(fastify as any).authenticate) {
    throw new AuthRequiredError("Auth plugin not registered");
  }
  const cachedUser = request.user as AuthenticatedUser | undefined;
  if (cachedUser?.id) return cachedUser;
  try {
    await fastify.authenticate(request);
  } catch {
    throw new AuthRequiredError("Invalid or expired authentication token");
  }
  const user = request.user as AuthenticatedUser | undefined;
  if (!user?.id) {
    throw new AuthRequiredError("Unauthenticated request");
  }
  return user;
}
