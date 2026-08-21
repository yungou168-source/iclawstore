import type { PrismaClient } from '@prisma/client';

export type CreateAuthSessionInput = {
  id: string;
  userId: string;
  issuer: string;
  tokenId?: string;
  expiresAt: Date;
};

type AuthSessionStore = Pick<PrismaClient, 'authSessions'>;

export class InvalidAuthSessionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAuthSessionInputError';
  }
}

const assertCreateInput = (input: CreateAuthSessionInput, now: Date): void => {
  for (const [field, value] of Object.entries(input)) {
    if (field === 'tokenId') continue;
    if (field === 'expiresAt') continue;
    if (typeof value !== 'string' || !value.trim()) {
      throw new InvalidAuthSessionInputError(`${field} is required`);
    }
  }
  if (!(input.expiresAt instanceof Date) || Number.isNaN(input.expiresAt.getTime())) {
    throw new InvalidAuthSessionInputError('expiresAt must be a valid date');
  }
  if (input.expiresAt <= now) {
    throw new InvalidAuthSessionInputError('expiresAt must be in the future');
  }
  if (input.tokenId !== undefined && !input.tokenId.trim()) {
    throw new InvalidAuthSessionInputError('tokenId must not be empty');
  }
};

export const createAuthSessionRepository = (prisma: AuthSessionStore) => ({
  async create(input: CreateAuthSessionInput, now = new Date()) {
    assertCreateInput(input, now);
    return prisma.authSessions.create({
      data: {
        ...input,
        lastAuthenticatedAt: now,
      },
    });
  },

  findActive(
    id: string,
    userId: string,
    issuer: string,
    tokenId?: string,
    now = new Date(),
  ) {
    return prisma.authSessions.findFirst({
      where: {
        id,
        userId,
        issuer,
        ...(tokenId ? { tokenId } : {}),
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: { id: true },
    });
  },

  touch(id: string, at = new Date()) {
    return prisma.authSessions.update({
      where: { id },
      data: { lastAuthenticatedAt: at },
    });
  },

  revoke(id: string, userId: string, at = new Date()) {
    return prisma.authSessions.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: at },
    });
  },

  revokeAllForUser(userId: string, at = new Date()) {
    return prisma.authSessions.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: at },
    });
  },
});
