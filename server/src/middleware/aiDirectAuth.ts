import { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * AI Direct Hiring auth middleware.
 * Reuses the Fastify `authenticate` hook attached to the app instance.
 * Throws an error (not a reply) so callers can decide how to respond.
 */
export class AuthRequiredError extends Error {
  readonly code = 'AUTH_REQUIRED';
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

export class ForbiddenScopeError extends Error {
  readonly code = 'FORBIDDEN_SCOPE';
  constructor(message = 'Forbidden: insufficient scope') {
    super(message);
    this.name = 'ForbiddenScopeError';
  }
}

export interface AuthenticatedUser {
  id: string;
  role?: string;
  email?: string;
}

export async function requireAuth(
  fastify: FastifyInstance,
  request: FastifyRequest,
): Promise<AuthenticatedUser> {
  if (!(fastify as any).authenticate) {
    throw new AuthRequiredError('Auth plugin not registered');
  }
  await (fastify as any).authenticate(request);
  const user = (request as any).user as AuthenticatedUser | undefined;
  if (!user?.id) {
    throw new AuthRequiredError('Unauthenticated request');
  }
  return user;
}
