import { describe, expect, it, vi } from 'bun:test';
import { OutboxDispatcher } from '../src/services/outboxDispatcher.js';
import { resolveWorkflowTemplate } from '../src/services/workflowTemplateRegistry.js';

describe('workflowTemplateRegistry', () => {
  it('maps employment lifecycle transitions to stable workflow steps', () => {
    const template = resolveWorkflowTemplate({
      id: 'event-1',
      aggregateType: 'employment',
      aggregateId: 'employment-1',
      eventType: 'employment.transition.v1',
      payload: { to: 'onboarding' },
    });
    expect(template).toEqual({
      workflowKey: 'employment.onboarding',
      workflowVersion: 'v1',
      steps: [
        { stepKey: 'employment.context.prepare' },
        { stepKey: 'employment.capabilities.resolve' },
      ],
    });
  });

  it('does not invent workflows for unrelated domain events', () => {
    expect(resolveWorkflowTemplate({
      id: 'event-2',
      aggregateType: 'offer',
      aggregateId: 'offer-1',
      eventType: 'offer.created.v1',
      payload: {},
    })).toBeNull();
  });
});

function makeDispatcherPool(row: Record<string, unknown>) {
  const statements: Array<{ sql: string; values?: unknown[] }> = [];
  const connection = {
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
    release: vi.fn(),
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values });
      if (sql.includes('FROM ai_direct_outbox_events')) return [[row], []];
      if (sql.includes('FROM ai_direct_employments')) {
        return [[{
          organizationId: 'org-1',
          agentVersionId: 'version-1',
          requestedByUserId: 'requester-1',
        }], []];
      }
      return [{ affectedRows: 1 }, []];
    }),
  };
  const pool = {
    getConnection: vi.fn(async () => connection),
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values });
      return [{ affectedRows: 1 }, []];
    }),
  };
  return { pool, connection, statements };
}

describe('OutboxDispatcher', () => {
  it('enqueues and publishes a mapped event in one transaction', async () => {
    const { pool, connection, statements } = makeDispatcherPool({
      id: 'event-1',
      organizationId: null,
      aggregateType: 'employment',
      aggregateId: 'employment-1',
      eventType: 'employment.transition.v1',
      payload: JSON.stringify({ employmentId: 'employment-1', to: 'active', actorUserId: 'user-1' }),
      attempts: 0,
    });
    const result = await new OutboxDispatcher(pool as any).dispatchNext();

    expect(result.kind).toBe('enqueued');
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(statements.some(({ sql }) => sql.includes('INSERT INTO ai_direct_workflow_runs'))).toBe(true);
    expect(statements.some(({ sql }) => sql.includes("SET status = 'published'"))).toBe(true);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('publishes unsupported events without creating a run', async () => {
    const { pool, statements } = makeDispatcherPool({
      id: 'event-2',
      organizationId: 'org-1',
      aggregateType: 'offer',
      aggregateId: 'offer-1',
      eventType: 'offer.created.v1',
      payload: {},
      attempts: 0,
    });
    const result = await new OutboxDispatcher(pool as any).dispatchNext();

    expect(result).toEqual({ kind: 'ignored', eventId: 'event-2', eventType: 'offer.created.v1' });
    expect(statements.some(({ sql }) => sql.includes('INSERT INTO ai_direct_workflow_runs'))).toBe(false);
  });

  it('rolls back and schedules retry when payload is invalid', async () => {
    const { pool, connection } = makeDispatcherPool({
      id: 'event-3',
      organizationId: null,
      aggregateType: 'employment',
      aggregateId: 'employment-1',
      eventType: 'employment.transition.v1',
      payload: '[]',
      attempts: 0,
    });
    await expect(new OutboxDispatcher(pool as any).dispatchNext()).rejects.toThrow(
      'Outbox payload must be a JSON object',
    );

    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(String(pool.query.mock.calls[0]?.[0])).toContain('attempts = ?');
  });
});