import { describe, expect, it, vi } from 'bun:test';
import { createComparePublicProfileAdapter } from '../src/domains/profiles/comparePublicProfileAdapter.js';
import {
  createMysqlFallbackPublicProfileAdapter,
  createProfilePortForMode,
  profileReadModeFromEnvironment,
} from '../src/domains/profiles/profilePortFactory.js';
import { createMysqlPublicProfileAdapter } from '../src/domains/profiles/mysqlPublicProfileAdapter.js';
import { createMysqlProfileDifferenceSink } from '../src/domains/profiles/comparePublicProfileAdapter.js';

const profile = {
  user: { _id: 'users:1', _creationTime: 1, handle: 'alice', displayName: 'Alice' },
  profileSlug: 'alice',
  publisher: null,
} as const;

describe('profile domain adapters', () => {
  it('returns Convex data when comparison reports differences', async () => {
    const convex = { getBySlug: vi.fn(async () => profile) };
    const mysql = { getBySlug: vi.fn(async () => null) };
    const sink = { record: vi.fn(async () => undefined) };
    const adapter = createComparePublicProfileAdapter(convex, mysql, sink);
    await expect(adapter.getBySlug('alice')).resolves.toEqual(profile);
    expect(sink.record).toHaveBeenCalledWith([
      expect.objectContaining({ stableId: 'users:1', fieldName: 'profile', differenceKind: 'missing' }),
    ]);
  });

  it('returns Convex data when MySQL comparison fails', async () => {
    const convex = { getBySlug: vi.fn(async () => profile) };
    const mysql = { getBySlug: vi.fn(async () => { throw new Error('unavailable'); }) };
    const sink = { record: vi.fn(async () => undefined) };
    const warn = vi.fn();
    const adapter = createComparePublicProfileAdapter(convex, mysql, sink, { warn });
    await expect(adapter.getBySlug('alice')).resolves.toEqual(profile);
    expect(warn).toHaveBeenCalled();
  });

  it('does not query MySQL when Convex has no profile in compare mode', async () => {
    const convex = { getBySlug: vi.fn(async () => null) };
    const mysql = { getBySlug: vi.fn(async () => profile) };
    const sink = { record: vi.fn(async () => undefined) };
    const adapter = createProfilePortForMode({ mode: 'compare', convex, mysql, sink });
    await expect(adapter.getBySlug('missing')).resolves.toBeNull();
    expect(mysql.getBySlug).not.toHaveBeenCalled();
    expect(sink.record).not.toHaveBeenCalled();
  });

  it('uses MySQL first and falls back to Convex for a missing or failed MySQL read', async () => {
    const convex = { getBySlug: vi.fn(async () => profile) };
    const missingMysql = { getBySlug: vi.fn(async () => null) };
    const failedMysql = { getBySlug: vi.fn(async () => { throw new Error('unavailable'); }) };

    await expect(createMysqlFallbackPublicProfileAdapter(missingMysql, convex).getBySlug('alice')).resolves.toEqual(profile);
    await expect(createMysqlFallbackPublicProfileAdapter(failedMysql, convex).getBySlug('alice')).resolves.toEqual(profile);
    expect(convex.getBySlug).toHaveBeenCalledTimes(2);
  });

  it('uses a MySQL profile without querying Convex in mysql mode', async () => {
    const mysql = { getBySlug: vi.fn(async () => profile) };
    const convex = { getBySlug: vi.fn(async () => null) };
    const adapter = createProfilePortForMode({ mode: 'mysql', convex, mysql });
    await expect(adapter.getBySlug('alice')).resolves.toEqual(profile);
    expect(convex.getBySlug).not.toHaveBeenCalled();
  });

  it('normalizes lookup input and omits deleted or deactivated MySQL snapshots', async () => {
    const query = vi.fn(async () => [[{
      legacyConvexId: 'users:1', handle: 'alice', profileSlug: 'alice', name: null, displayName: 'Alice',
      bio: null, image: null, legacyCreationTime: 1,
    }], []]);
    const adapter = createMysqlPublicProfileAdapter({ query } as never);
    await expect(adapter.getBySlug(' ALICE ')).resolves.toEqual(profile);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('deletedAt IS NULL'), ['alice', 'alice']);
    expect(query.mock.calls[0]?.[0]).toContain('deactivatedAt IS NULL');
  });

  it('updates a stable reconciliation record key for repeated differences', async () => {
    const query = vi.fn(async () => [{ affectedRows: 1 }, []]);
    const sink = createMysqlProfileDifferenceSink({ query } as never);
    const difference = { stableId: 'users:1', fieldName: 'profileSlug', differenceKind: 'value_mismatch' as const, summary: 'different' };
    await sink.record([difference]);
    await sink.record([{ ...difference, summary: 'still different' }]);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[1]?.[0]).toBe(query.mock.calls[1]?.[1]?.[0]);
    expect(query.mock.calls[0]?.[0]).toContain('ON DUPLICATE KEY UPDATE');
  });

  it.each([undefined, 'invalid', ''])('fails closed to Convex for invalid mode %p', (mode) => {
    expect(profileReadModeFromEnvironment({ PROFILE_READ_MODE: mode })).toBe('convex');
  });

  it.each(['convex', 'compare', 'mysql'])('accepts supported server modes', (mode) => {
    expect(profileReadModeFromEnvironment({ PROFILE_READ_MODE: mode })).toBe(mode);
  });
});