import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { PrismaClient } from '@prisma/client';
import { AuthRequiredError, type AuthenticatedUser } from '../middleware/aiDirectAuth.js';
import { createAuthSessionRepository } from './authSessionRepository.js';

type JwtConfig = {
  issuer: string;
  audience: string;
  jwksUri: string;
};

type JwtAuthenticator = {
  authenticate(authorization: string | undefined): Promise<AuthenticatedUser>;
};

const normalize = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/$/, '') : undefined;
};

const bearerToken = (authorization: string | undefined): string => {
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) throw new AuthRequiredError('Bearer authentication token required');
  return match[1];
};

export const jwtConfigFromEnvironment = (
  env: NodeJS.ProcessEnv = process.env,
): JwtConfig | null => {
  const issuer = normalize(env.AUTH_ISSUER);
  const audience = normalize(env.AUTH_AUDIENCE);
  const jwksUri = normalize(env.AUTH_JWKS_URI);
  if (!issuer || !audience || !jwksUri) return null;
  return { issuer, audience, jwksUri };
};

export const subjectFromClaims = (payload: JWTPayload): string => {
  if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
    throw new AuthRequiredError('Authentication token has no stable subject');
  }
  return payload.sub;
};

export const sessionIdFromClaims = (payload: JWTPayload): string => {
  if (typeof payload.sid !== 'string' || !payload.sid.trim()) {
    throw new AuthRequiredError('Authentication token has no session identifier');
  }
  return payload.sid;
};

export const tokenIdFromClaims = (payload: JWTPayload): string | undefined => {
  if (payload.jti === undefined) return undefined;
  if (typeof payload.jti !== 'string' || !payload.jti.trim()) {
    throw new AuthRequiredError('Authentication token has an invalid token identifier');
  }
  return payload.jti;
};

const activeUser = async (prisma: PrismaClient, subject: string) => {
  const user = await prisma.users.findUnique({
    where: { id: subject },
    select: {
      id: true,
      email: true,
      name: true,
      handle: true,
      displayName: true,
      image: true,
      role: true,
      deactivatedAt: true,
      deletedAt: true,
    },
  });
  if (!user || user.deactivatedAt || user.deletedAt) {
    throw new AuthRequiredError('Account is no longer active');
  }
  return user;
};

export const createJwtAuthenticator = (
  prisma: PrismaClient,
  config: JwtConfig,
): JwtAuthenticator => {
  const sessions = createAuthSessionRepository(prisma);
  const jwks = createRemoteJWKSet(new URL(config.jwksUri), {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
  });

  return {
    async authenticate(authorization) {
      const token = bearerToken(authorization);
      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer: config.issuer,
          audience: config.audience,
          algorithms: ['RS256'],
          clockTolerance: 5,
          maxTokenAge: '15m',
        });
        const subject = subjectFromClaims(payload);
        const sessionId = sessionIdFromClaims(payload);
        const tokenId = tokenIdFromClaims(payload);
        const session = await sessions.findActive(sessionId, subject, config.issuer, tokenId);
        if (!session) throw new AuthRequiredError('Authentication session is invalid or revoked');
        await sessions.touch(session.id);
        const user = await activeUser(prisma, subject);
        return {
          id: user.id,
          issuer: config.issuer,
          subject,
          sessionId,
          authSource: 'jwt',
          email: user.email ?? undefined,
          name: user.name ?? undefined,
          handle: user.handle ?? undefined,
          displayName: user.displayName ?? undefined,
          image: user.image ?? undefined,
          role: user.role ?? undefined,
        };
      } catch (error) {
        if (error instanceof AuthRequiredError) throw error;
        throw new AuthRequiredError('Invalid or expired authentication token');
      }
    },
  };
};