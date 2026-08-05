import { describe, expect, it, vi } from 'bun:test';
import { expireDueApprovals } from '../src/services/approvalTimeoutWorker.js';

describe('approval timeout worker', () => {
  it('records one immutable event, audit entry and outbox event per claimed expiry', async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const conn = {
      beginTransaction: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
      release: vi.fn(),
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        queries.push({ sql, values });
        if (sql.includes('FOR UPDATE SKIP LOCKED')) {
          return [[{ id: 'approval-1', organizationId: 'org-1', targetType: 'offer', targetId: 'offer-1' }], []];
        }
        if (sql.startsWith('UPDATE ai_direct_approvals')) return [{ affectedRows: 1 }, []];
        if (sql.includes('MAX(sequence)')) return [[{ nextSequence: 1 }], []];
        return [{ affectedRows: 1 }, []];
      }),
    };

    const expired = await expireDueApprovals({ getConnection: async () => conn } as any);

    expect(expired).toBe(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(queries.some(({ sql }) => sql.includes('INSERT INTO ai_direct_approval_events'))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes("'approval.expired'"))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('INSERT INTO ai_direct_audit_events'))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('INSERT INTO ai_direct_outbox_events'))).toBe(true);
  });

  it('does not create events when another transaction already changed the approval', async () => {
    const queries: string[] = [];
    const conn = {
      beginTransaction: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
      release: vi.fn(),
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('FOR UPDATE SKIP LOCKED')) {
          return [[{ id: 'approval-1', organizationId: 'org-1', targetType: 'offer', targetId: 'offer-1' }], []];
        }
        if (sql.startsWith('UPDATE ai_direct_approvals')) return [{ affectedRows: 0 }, []];
        return [{ affectedRows: 1 }, []];
      }),
    };

    const expired = await expireDueApprovals({ getConnection: async () => conn } as any);

    expect(expired).toBe(0);
    expect(queries.some((sql) => sql.includes('INSERT INTO ai_direct_approval_events'))).toBe(false);
    expect(queries.some((sql) => sql.includes('INSERT INTO ai_direct_audit_events'))).toBe(false);
    expect(queries.some((sql) => sql.includes('INSERT INTO ai_direct_outbox_events'))).toBe(false);
  });
});