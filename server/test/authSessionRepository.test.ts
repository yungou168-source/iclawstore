import { describe, expect, it, vi } from 'vitest';
import { createAuthSessionRepository } from '../src/services/authSessionRepository.js';

describe('auth session repository', () => {
  it('binds an active session lookup to the token id when present', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'session-1' });
    const repository = createAuthSessionRepository({
      authSessions: { findFirst },
    } as never);

    await repository.findActive('session-1', 'user-1', 'https://issuer.test', 'token-1');

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'session-1',
        userId: 'user-1',
        issuer: 'https://issuer.test',
        tokenId: 'token-1',
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      select: { id: true },
    });
  });

  it('keeps legacy sessions compatible when the token has no jti', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repository = createAuthSessionRepository({
      authSessions: { findFirst },
    } as never);

    await repository.findActive('session-1', 'user-1', 'https://issuer.test');

    expect(findFirst.mock.calls[0]?.[0].where).not.toHaveProperty('tokenId');
  });

  it('creates a session with the authentication timestamp supplied by the caller', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'session-1' });
    const repository = createAuthSessionRepository({
      authSessions: { create },
    } as never);
    const now = new Date('2026-03-14T10:00:00.000Z');
    const expiresAt = new Date('2026-03-14T11:00:00.000Z');

    await repository.create(
      { id: 'session-1', userId: 'user-1', issuer: 'https://issuer.test', tokenId: 'token-1', expiresAt },
      now,
    );

    expect(create).toHaveBeenCalledWith({
      data: {
        id: 'session-1',
        userId: 'user-1',
        issuer: 'https://issuer.test',
        tokenId: 'token-1',
        expiresAt,
        lastAuthenticatedAt: now,
      },
    });
  });

  it('rejects missing identity fields and expired sessions before writing', async () => {
    const create = vi.fn();
    const repository = createAuthSessionRepository({
      authSessions: { create },
    } as never);
    const now = new Date('2026-03-14T10:00:00.000Z');

    await expect(
      repository.create(
        { id: '', userId: 'user-1', issuer: 'https://issuer.test', expiresAt: new Date('2026-03-14T11:00:00.000Z') },
        now,
      ),
    ).rejects.toThrow('id is required');
    await expect(
      repository.create(
        { id: 'session-1', userId: 'user-1', issuer: 'https://issuer.test', expiresAt: now },
        now,
      ),
    ).rejects.toThrow('future');
    expect(create).not.toHaveBeenCalled();
  });
});