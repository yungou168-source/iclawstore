import { describe, expect, it, vi } from 'bun:test';
import { expireDueApprovals } from '../src/services/approvalTimeoutWorker.js';

function makeTimeoutHarness(
  lockedApproval: Record<string, unknown>,
  offerAffectedRows = 1,
) {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const connection = {
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
    release: vi.fn(),
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      if (sql.includes('FOR UPDATE')) return [[lockedApproval], []];
      if (sql.startsWith('UPDATE ai_direct_approvals')) return [{ affectedRows: 1 }, []];
      if (sql.startsWith('UPDATE ai_direct_offers')) return [{ affectedRows: offerAffectedRows }, []];
      if (sql.includes('MAX(sequence)')) return [[{ nextSequence: 1 }], []];
      if (sql.startsWith('SELECT * FROM ai_direct_approvals')) {
        return [[{ ...lockedApproval, status: 'expired', decision: 'expired' }], []];
      }
      return [{ affectedRows: 1 }, []];
    }),
  };
  const pool = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("WHERE status = 'pending'")) return [[{ id: 'approval-1' }], []];
      return [[], []];
    }),
    getConnection: vi.fn(async () => connection),
  };
  return { pool, connection, queries };
}

const pendingApproval = {
  id: 'approval-1',
  organizationId: 'org-1',
  targetType: 'offer',
  targetId: 'offer-1',
  requestedByUserId: 'requester-1',
  approverUserId: null,
  status: 'pending',
  expiresAt: new Date('2026-08-01T00:00:00.000Z'),
  isDue: 1,
};

describe('approval timeout worker', () => {
  it('expires the approval and linked offer through the unified transaction', async () => {
    const { pool, connection, queries } = makeTimeoutHarness(pendingApproval);

    const expired = await expireDueApprovals(pool as any);

    expect(expired).toBe(1);
    const offerUpdate = queries.find(({ sql }) => sql.startsWith('UPDATE ai_direct_offers'));
    expect(offerUpdate?.values?.[0]).toBe('expired');
    expect(queries.some(({ sql }) => sql.includes('INSERT INTO ai_direct_approval_events'))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('INSERT INTO ai_direct_audit_events'))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('INSERT INTO ai_direct_outbox_events'))).toBe(true);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  it('lets a concurrent manual decision win without writing a second result', async () => {
    const { pool, connection, queries } = makeTimeoutHarness({
      ...pendingApproval,
      status: 'approved',
      isDue: 1,
    });

    const expired = await expireDueApprovals(pool as any);

    expect(expired).toBe(0);
    expect(queries.some(({ sql }) => sql.startsWith('UPDATE ai_direct_approvals'))).toBe(false);
    expect(queries.some(({ sql }) => sql.startsWith('UPDATE ai_direct_offers'))).toBe(false);
    expect(queries.some(({ sql }) => sql.includes('INSERT INTO ai_direct_approval_events'))).toBe(false);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it('surfaces linked offer conflicts instead of counting a partial expiry', async () => {
    const { pool, connection } = makeTimeoutHarness(pendingApproval, 0);

    await expect(expireDueApprovals(pool as any)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
      details: { approvalId: 'approval-1', offerId: 'offer-1' },
    });

    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });
});
