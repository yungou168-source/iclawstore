import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type RefreshTokenRecord = {
  tokenHash: string;
  familyId: string;
  sessionId: string;
  userId: string;
  issuedAt: Date;
  expiresAt: Date;
  usedAt?: Date;
  revokedAt?: Date;
};

export type RefreshTokenStore = {
  findByHash(hash: string): Promise<RefreshTokenRecord | null>;
  insert(record: RefreshTokenRecord): Promise<void>;
  markUsed(hash: string, at: Date): Promise<boolean>;
  revokeFamily(familyId: string, at: Date): Promise<void>;
  revokeAllForUser(userId: string, at: Date): Promise<void>;
};

export type RefreshRotationResult =
  | { kind: 'rotated'; refreshToken: string; familyId: string; sessionId: string; userId: string }
  | { kind: 'invalid' | 'expired' | 'revoked' | 'reuse-detected' };

export const hashRefreshToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

const equalHash = (a: string, b: string): boolean => {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
};

export const rotateRefreshToken = async (
  store: RefreshTokenStore,
  presentedToken: string,
  options: { now?: Date; issueToken?: () => string; ttlMs: number },
): Promise<RefreshRotationResult> => {
  const now = options.now ?? new Date();
  const hash = hashRefreshToken(presentedToken);
  const current = await store.findByHash(hash);
  if (!current || !equalHash(current.tokenHash, hash)) return { kind: 'invalid' };
  if (current.revokedAt) return { kind: 'revoked' };
  if (current.expiresAt <= now) return { kind: 'expired' };
  if (current.usedAt) {
    await store.revokeFamily(current.familyId, now);
    return { kind: 'reuse-detected' };
  }
  const marked = await store.markUsed(hash, now);
  if (!marked) {
    await store.revokeFamily(current.familyId, now);
    return { kind: 'reuse-detected' };
  }
  const refreshToken = (options.issueToken ?? (() => randomBytes(32).toString('base64url')))();
  await store.insert({
    tokenHash: hashRefreshToken(refreshToken),
    familyId: current.familyId,
    sessionId: current.sessionId,
    userId: current.userId,
    issuedAt: now,
    expiresAt: new Date(now.getTime() + options.ttlMs),
  });
  return { kind: 'rotated', refreshToken, familyId: current.familyId, sessionId: current.sessionId, userId: current.userId };
};

export const revokeRefreshFamily = (store: RefreshTokenStore, familyId: string, now = new Date()) =>
  store.revokeFamily(familyId, now);

export const logoutAll = (store: RefreshTokenStore, userId: string, now = new Date()) =>
  store.revokeAllForUser(userId, now);