import { describe, expect, it } from 'vitest';
import { hashRefreshToken, logoutAll, rotateRefreshToken, type RefreshTokenRecord, type RefreshTokenStore } from '../src/services/refreshTokenFamily.js';

const fakeStore = (initial: RefreshTokenRecord): RefreshTokenStore & { rows: RefreshTokenRecord[]; families: string[]; users: string[] } => {
  const rows = [initial];
  const families: string[] = [];
  const users: string[] = [];
  return {
    rows, families, users,
    async findByHash(hash) { return rows.find((row) => row.tokenHash === hash) ?? null; },
    async insert(row) { rows.push(row); },
    async markUsed(hash, at) { const row = rows.find((item) => item.tokenHash === hash); if (!row || row.usedAt) return false; row.usedAt = at; return true; },
    async revokeFamily(familyId, at) { families.push(familyId); rows.filter((row) => row.familyId === familyId).forEach((row) => { row.revokedAt = at; }); },
    async revokeAllForUser(userId, at) { users.push(userId); rows.filter((row) => row.userId === userId).forEach((row) => { row.revokedAt = at; }); },
  };
};

const record = (token: string): RefreshTokenRecord => ({ tokenHash: hashRefreshToken(token), familyId: 'family-1', sessionId: 'session-1', userId: 'user-1', issuedAt: new Date('2026-01-01'), expiresAt: new Date('2099-01-01') });

describe('candidate refresh-token family boundary', () => {
  it('persists only refresh token hashes and rotates once', async () => {
    const store = fakeStore(record('old'));
    const result = await rotateRefreshToken(store, 'old', { now: new Date('2026-01-02'), ttlMs: 3_600_000, issueToken: () => 'new' });
    expect(result.kind).toBe('rotated');
    expect(store.rows.every((row) => row.tokenHash !== 'old' && row.tokenHash.length === 64)).toBe(true);
    expect(store.rows.some((row) => row.tokenHash === hashRefreshToken('new'))).toBe(true);
  });

  it('detects reuse and revokes the whole family', async () => {
    const store = fakeStore(record('old'));
    await rotateRefreshToken(store, 'old', { now: new Date('2026-01-02'), ttlMs: 1000, issueToken: () => 'new' });
    expect(await rotateRefreshToken(store, 'old', { now: new Date('2026-01-03'), ttlMs: 1000 })).toEqual({ kind: 'reuse-detected' });
    expect(store.families).toEqual(['family-1']);
    expect(store.rows.every((row) => row.revokedAt)).toBe(true);
  });

  it('provides a user-scoped logout-all port', async () => {
    const store = fakeStore(record('old'));
    await logoutAll(store, 'user-1', new Date('2026-01-02'));
    expect(store.users).toEqual(['user-1']);
    expect(store.rows[0].revokedAt).toEqual(new Date('2026-01-02'));
  });
});