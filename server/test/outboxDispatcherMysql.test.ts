import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createPool, type Pool } from 'mysql2/promise';
import { OutboxDispatcher } from '../src/services/outboxDispatcher.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('Outbox dispatcher MySQL transaction closure', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createPool({ uri: databaseUrl!, connectionLimit: 2 });
    for (const table of [
      'ai_direct_workflow_run_steps',
      'ai_direct_workflow_runs',
      'ai_direct_outbox_events',
      'ai_direct_employments',
      'ai_direct_companies',
    ]) {
      await pool.query(`DELETE FROM ${table}`);
    }
    await pool.query(
      `INSERT INTO ai_direct_companies
       (id, organizationId, name, slug, status, createdByUserId)
       VALUES ('company-1', 'organization-1', 'Runtime Company', 'runtime-company', 'active', 'owner-1')`,
    );
    await pool.query(
      `INSERT INTO ai_direct_employments
       (id, companyId, agentId, agentVersionId, roleId, offerId, requestedByUserId, status)
       VALUES ('employment-1', 'company-1', 'agent-1', 'version-1', 'role-1', 'offer-1', 'owner-1', 'active')`,
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('atomically turns a lifecycle event into one scoped workflow run', async () => {
    await pool.query(
      `INSERT INTO ai_direct_outbox_events
       (id, organizationId, aggregateType, aggregateId, eventType, payloadVersion, payload)
       VALUES ('event-1', NULL, 'employment', 'employment-1', 'employment.transition.v1', 1, ?)`,
      [JSON.stringify({
        employmentId: 'employment-1',
        companyId: 'company-1',
        to: 'active',
        actorUserId: 'owner-1',
      })],
    );

    const result = await new OutboxDispatcher(pool).dispatchNext();
    expect(result.kind).toBe('enqueued');

    const [events] = await pool.query(
      `SELECT status, attempts, publishedAt FROM ai_direct_outbox_events WHERE id = 'event-1'`,
    );
    expect((events as any[])[0].status).toBe('published');
    expect((events as any[])[0].attempts).toBe(0);
    expect((events as any[])[0].publishedAt).not.toBeNull();

    const [runs] = await pool.query(
      `SELECT id, organizationId, employmentId, agentVersionId, workflowKey,
              requestedByUserId, idempotencyKey, status
       FROM ai_direct_workflow_runs WHERE idempotencyKey = 'outbox:event-1'`,
    );
    expect(runs).toHaveLength(1);
    expect((runs as any[])[0]).toMatchObject({
      organizationId: 'organization-1',
      employmentId: 'employment-1',
      agentVersionId: 'version-1',
      workflowKey: 'employment.activation',
      requestedByUserId: 'owner-1',
      status: 'queued',
    });

    const [steps] = await pool.query(
      `SELECT stepKey, sequence, status FROM ai_direct_workflow_run_steps
       WHERE runId = ? ORDER BY sequence`,
      [(runs as any[])[0].id],
    );
    expect(steps).toEqual([{
      stepKey: 'employment.activation.publish',
      sequence: 1,
      status: 'pending',
    }]);
  });

  it('consumes queue-generated informational events without recursion', async () => {
    const result = await new OutboxDispatcher(pool).dispatchNext();
    expect(result.kind).toBe('ignored');

    const [runs] = await pool.query('SELECT COUNT(*) AS count FROM ai_direct_workflow_runs');
    expect(Number((runs as any[])[0].count)).toBe(1);
    const next = await new OutboxDispatcher(pool).dispatchNext();
    expect(next).toEqual({ kind: 'idle' });
  });
});