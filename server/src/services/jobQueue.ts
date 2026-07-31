/**
 * Job Queue Service — AI Direct Hiring P1 Runtime Center (Agent G).
 *
 * Manages `ai_direct_workflow_runs` and `ai_direct_workflow_run_steps` rows.
 * Provides:
 *   - enqueue(): create a new run + initial pending step in one transaction
 *   - leaseNext(): atomically claim the next queued run for a worker
 *   - ack(): worker confirms it has started the run (sets lease + startedAt)
 *   - completeStep(): mark a step as completed with output summary
 *   - failStep(): mark a step (or run) as failed with code/reason
 *   - cancel(): cancel a queued or active run (terminal)
 *   - retry(): clone a failed run into a new queued run with same payload
 *
 * Lease strategy: single-worker SELECT ... FOR UPDATE SKIP LOCKED + status flip
 * inside the same transaction. `leaseExpiresAt` is set to NOW + LEASE_TTL so
 * crashed workers don't strand runs forever. Workers must heartbeat via
 * `aiDirectWorkersRoutes.heartbeat` and complete via `complete` to release
 * the lease. Lease TTL is short (60s) — workers should ack immediately and
 * re-heartbeat every < 30s.
 *
 * State machine (runs):
 *   queued → active → (running | succeeded | failed | cancelled)
 *   States `succeeded`, `failed`, `cancelled` are terminal.
 */

import { randomUUID } from 'node:crypto';
import { Pool, PoolConnection } from 'mysql2/promise';

export const RUN_STATUSES = [
  'queued',
  'active',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const STEP_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'skipped',
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const LEASE_TTL_SECONDS = 60;
export const STEP_LEASE_TTL_SECONDS = 30;

export interface EnqueueInput {
  workflowKey: string;
  workflowVersion?: string;
  organizationId?: string | null;
  employmentId?: string | null;
  agentVersionId?: string | null;
  requestedByUserId: string;
  approvalId?: string | null;
  requestedModelPolicy?: Record<string, unknown> | null;
  inputSummary?: Record<string, unknown> | null;
  priority?: number;
  runAfter?: Date | null;
  initialSteps: Array<{ stepKey: string; metadata?: Record<string, unknown> }>;
}

export interface RunContext {
  runId: string;
  workflowKey: string;
  status: RunStatus;
  stepCount: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  payload: Record<string, unknown>;
}

export interface StepContext {
  stepId: string;
  stepKey: string;
  sequence: number;
  status: StepStatus;
}

function nowPlus(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}

function isTerminal(status: RunStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

async function beginConn(pool: Pool): Promise<PoolConnection> {
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  return conn;
}

async function writeAudit(
  conn: PoolConnection,
  input: {
    organizationId: string | null;
    actorUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    requestId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await conn.query(
    `INSERT INTO ai_direct_audit_events
     (id, organizationId, actorUserId, action, targetType, targetId, requestId, outcome, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'success', ?)`,
    [
      randomUUID(),
      input.organizationId,
      input.actorUserId,
      input.action,
      input.targetType,
      input.targetId,
      input.requestId,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );
}

async function publishOutboxEvent(
  conn: PoolConnection,
  input: {
    organizationId: string | null;
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await conn.query(
    `INSERT INTO ai_direct_outbox_events
     (id, organizationId, aggregateType, aggregateId, eventType, payloadVersion, payload)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
    [
      randomUUID(),
      input.organizationId,
      input.aggregateType,
      input.aggregateId,
      input.eventType,
      JSON.stringify(input.payload),
    ],
  );
}

export class JobQueueService {
  constructor(
    private readonly pool: Pool,
    private readonly requestId: string = randomUUID(),
  ) {}

  /**
   * Enqueue a new workflow run with its initial steps. Atomic.
   */
  async enqueue(input: EnqueueInput): Promise<{ runId: string; stepIds: string[] }> {
    if (!input.initialSteps.length) {
      throw new Error('enqueue requires at least one initial step');
    }
    const runId = randomUUID();
    const stepIds = input.initialSteps.map(() => randomUUID());
    const conn = await beginConn(this.pool);
    try {
      await conn.query(
        `INSERT INTO ai_direct_workflow_runs
         (id, organizationId, employmentId, agentVersionId, workflowKey, workflowVersion,
          status, requestedByUserId, approvalId, requestedModelPolicy,
          inputSummary, startedAt, leaseExpiresAt)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, NULL, ?)`,
        [
          runId,
          input.organizationId ?? null,
          input.employmentId ?? null,
          input.agentVersionId ?? null,
          input.workflowKey,
          input.workflowVersion ?? null,
          input.requestedByUserId,
          input.approvalId ?? null,
          input.requestedModelPolicy ? JSON.stringify(input.requestedModelPolicy) : null,
          input.inputSummary ? JSON.stringify(input.inputSummary) : null,
          input.runAfter ?? null,
        ],
      );
      // Insert initial steps with sequence = index + 1.
      for (let i = 0; i < input.initialSteps.length; i++) {
        const step = input.initialSteps[i];
        await conn.query(
          `INSERT INTO ai_direct_workflow_run_steps
           (id, runId, stepKey, sequence, status, metadata)
           VALUES (?, ?, ?, ?, 'pending', ?)`,
          [
            stepIds[i],
            runId,
            step.stepKey,
            i + 1,
            step.metadata ? JSON.stringify(step.metadata) : null,
          ],
        );
      }
      await writeAudit(conn, {
        organizationId: input.organizationId ?? null,
        actorUserId: input.requestedByUserId,
        action: 'workflow_run.enqueued',
        targetType: 'workflow_run',
        targetId: runId,
        requestId: this.requestId,
        metadata: {
          workflowKey: input.workflowKey,
          stepCount: input.initialSteps.length,
        },
      });
      await publishOutboxEvent(conn, {
        organizationId: input.organizationId ?? null,
        aggregateType: 'workflow_run',
        aggregateId: runId,
        eventType: 'workflow_run.enqueued.v1',
        payload: {
          runId,
          workflowKey: input.workflowKey,
          stepCount: input.initialSteps.length,
          requestedByUserId: input.requestedByUserId,
        },
      });
      await conn.commit();
      return { runId, stepIds };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Lease the next queued (or expired-leased active) run to a worker.
   *
   * Strategy: SELECT ... FOR UPDATE SKIP LOCKED on rows where:
   *   status = 'queued' AND (runAfter IS NULL OR runAfter <= NOW())
   *   OR (status = 'active' AND leaseExpiresAt <= NOW())  -- reclaim stranded
   * Then UPDATE status='active', leaseOwner=workerId, leaseExpiresAt=NOW()+TTL.
   * Worker must call `ack` shortly after to set startedAt.
   *
   * Returns null when nothing is available — workers should sleep + retry.
   */
  async leaseNext(workerId: string): Promise<RunContext | null> {
    const conn = await beginConn(this.pool);
    try {
      const [rows] = (await conn.query(
        `SELECT id, workflowKey, status, inputSummary
         FROM ai_direct_workflow_runs
         WHERE (status = 'queued' AND (runAfter IS NULL OR runAfter <= NOW()))
            OR (status = 'active' AND leaseExpiresAt IS NOT NULL AND leaseExpiresAt <= NOW())
         ORDER BY
           CASE WHEN status = 'queued' THEN 0 ELSE 1 END ASC,
           createdAt ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
      )) as any;
      const row = rows[0];
      if (!row) {
        await conn.rollback();
        return null;
      }
      const leaseExpiresAt = nowPlus(LEASE_TTL_SECONDS);
      await conn.query(
        `UPDATE ai_direct_workflow_runs
         SET status = 'active',
             leaseOwner = ?,
             leaseExpiresAt = ?,
             updatedAt = NOW()
         WHERE id = ?`,
        [workerId, leaseExpiresAt, row.id],
      );
      // Mark the first pending step as running.
      await conn.query(
        `UPDATE ai_direct_workflow_run_steps
         SET status = 'running',
             startedAt = COALESCE(startedAt, NOW()),
             metadata = JSON_SET(COALESCE(metadata, JSON_OBJECT()),
                                  '$.leasedByWorkerId', CAST(? AS JSON))
         WHERE runId = ? AND sequence = (
           SELECT MIN(sequence) FROM (
             SELECT sequence FROM ai_direct_workflow_run_steps
             WHERE runId = ? AND status = 'pending'
           ) AS p
         )`,
        [JSON.stringify(workerId), row.id, row.id],
      );
      await conn.commit();
      const inputSummary = row.inputSummary
        ? typeof row.inputSummary === 'string'
          ? JSON.parse(row.inputSummary)
          : row.inputSummary
        : {};
      // Count total steps for the run.
      const [stepRows] = (await this.pool.query(
        `SELECT COUNT(*) AS stepCount FROM ai_direct_workflow_run_steps WHERE runId = ?`,
        [row.id],
      )) as any;
      return {
        runId: row.id,
        workflowKey: row.workflowKey,
        status: 'active',
        stepCount: Number(stepRows[0]?.stepCount ?? 0),
        startedAt: null,
        finishedAt: null,
        payload: inputSummary,
      };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Worker acknowledges it has started the run (sets startedAt). Idempotent.
   */
  async ack(runId: string, workerId: string): Promise<void> {
    await this.pool.query(
      `UPDATE ai_direct_workflow_runs
       SET startedAt = COALESCE(startedAt, NOW()),
           leaseOwner = ?,
           leaseExpiresAt = ?,
           updatedAt = NOW()
       WHERE id = ? AND status = 'active' AND (leaseOwner = ? OR leaseExpiresAt <= NOW())`,
      [workerId, nowPlus(LEASE_TTL_SECONDS), runId, workerId],
    );
  }

  /**
   * Mark a step complete. If the step is the last pending step, the run
   * transitions to `succeeded`. Idempotent on already-completed steps.
   */
  async completeStep(
    runId: string,
    sequence: number,
    output: { outputSummary?: Record<string, unknown>; tokenUsage?: Record<string, unknown>; costMicros?: number | bigint; latencyMs?: number },
  ): Promise<{ runCompleted: boolean }> {
    const conn = await beginConn(this.pool);
    try {
      await conn.query(
        `UPDATE ai_direct_workflow_run_steps
         SET status = 'succeeded',
             finishedAt = NOW(),
             outputSummary = ?,
             tokenUsage = ?,
             costMicros = ?,
             latencyMs = ?
         WHERE runId = ? AND sequence = ? AND status IN ('pending', 'running')`,
        [
          output.outputSummary ? JSON.stringify(output.outputSummary) : null,
          output.tokenUsage ? JSON.stringify(output.tokenUsage) : null,
          output.costMicros ?? null,
          output.latencyMs ?? null,
          runId,
          sequence,
        ],
      );
      // Check if more pending steps remain.
      const [pending] = (await conn.query(
        `SELECT COUNT(*) AS remaining FROM ai_direct_workflow_run_steps
         WHERE runId = ? AND status = 'pending'`,
        [runId],
      )) as any;
      const remaining = Number(pending[0]?.remaining ?? 0);
      if (remaining > 0) {
        await conn.commit();
        return { runCompleted: false };
      }
      // No more pending steps — close the run.
      await conn.query(
        `UPDATE ai_direct_workflow_runs
         SET status = 'succeeded',
             finishedAt = NOW(),
             leaseOwner = NULL,
             leaseExpiresAt = NULL,
             updatedAt = NOW()
         WHERE id = ? AND status = 'active'`,
        [runId],
      );
      await writeAudit(conn, {
        organizationId: null,
        actorUserId: 'system',
        action: 'workflow_run.succeeded',
        targetType: 'workflow_run',
        targetId: runId,
        requestId: this.requestId,
      });
      await publishOutboxEvent(conn, {
        organizationId: null,
        aggregateType: 'workflow_run',
        aggregateId: runId,
        eventType: 'workflow_run.succeeded.v1',
        payload: { runId },
      });
      await conn.commit();
      return { runCompleted: true };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Fail a step + the whole run. Terminal.
   */
  async failStep(
    runId: string,
    sequence: number,
    failure: { code: string; reason?: string },
  ): Promise<void> {
    const conn = await beginConn(this.pool);
    try {
      await conn.query(
        `UPDATE ai_direct_workflow_run_steps
         SET status = 'failed',
             finishedAt = NOW(),
             failureCode = ?
         WHERE runId = ? AND sequence = ?`,
        [failure.code, runId, sequence],
      );
      await conn.query(
        `UPDATE ai_direct_workflow_runs
         SET status = 'failed',
             finishedAt = NOW(),
             failureCode = ?,
             failureReason = ?,
             leaseOwner = NULL,
             leaseExpiresAt = NULL,
             updatedAt = NOW()
         WHERE id = ? AND status IN ('queued', 'active')`,
        [failure.code, failure.reason ?? null, runId],
      );
      await writeAudit(conn, {
        organizationId: null,
        actorUserId: 'system',
        action: 'workflow_run.failed',
        targetType: 'workflow_run',
        targetId: runId,
        requestId: this.requestId,
        metadata: { sequence, code: failure.code, reason: failure.reason },
      });
      await publishOutboxEvent(conn, {
        organizationId: null,
        aggregateType: 'workflow_run',
        aggregateId: runId,
        eventType: 'workflow_run.failed.v1',
        payload: { runId, sequence, code: failure.code, reason: failure.reason },
      });
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Cancel a run. Allowed in `queued` or `active`. Terminal.
   */
  async cancel(runId: string, reason: string, actorUserId: string): Promise<void> {
    const conn = await beginConn(this.pool);
    try {
      const [rows] = (await conn.query(
        `SELECT status, organizationId FROM ai_direct_workflow_runs WHERE id = ? FOR UPDATE`,
        [runId],
      )) as any;
      const row = rows[0];
      if (!row) throw new Error('Run not found');
      if (isTerminal(row.status)) {
        await conn.rollback();
        throw new Error(`Run is already terminal (${row.status})`);
      }
      await conn.query(
        `UPDATE ai_direct_workflow_runs
         SET status = 'cancelled',
             finishedAt = NOW(),
             failureReason = ?,
             leaseOwner = NULL,
             leaseExpiresAt = NULL,
             updatedAt = NOW()
         WHERE id = ?`,
        [reason, runId],
      );
      // Mark pending/running steps as skipped.
      await conn.query(
        `UPDATE ai_direct_workflow_run_steps
         SET status = 'skipped', finishedAt = NOW()
         WHERE runId = ? AND status IN ('pending', 'running')`,
        [runId],
      );
      await writeAudit(conn, {
        organizationId: row.organizationId,
        actorUserId,
        action: 'workflow_run.cancelled',
        targetType: 'workflow_run',
        targetId: runId,
        requestId: this.requestId,
        metadata: { reason },
      });
      await publishOutboxEvent(conn, {
        organizationId: row.organizationId,
        aggregateType: 'workflow_run',
        aggregateId: runId,
        eventType: 'workflow_run.cancelled.v1',
        payload: { runId, reason, actorUserId },
      });
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Retry a failed/cancelled run by creating a new run with the same
   * workflow key, payload, and steps. Returns the new run id.
   */
  async retry(runId: string, actorUserId: string): Promise<{ runId: string }> {
    const [rows] = (await this.pool.query(
      `SELECT organizationId, employmentId, agentVersionId, workflowKey, workflowVersion,
              requestedByUserId, approvalId, requestedModelPolicy, inputSummary
       FROM ai_direct_workflow_runs WHERE id = ? LIMIT 1`,
      [runId],
    )) as any;
    const source = rows[0];
    if (!source) throw new Error('Source run not found');
    if (!isTerminal(source.status) && source.status !== 'failed') {
      throw new Error(`Only failed/terminal runs can be retried (current: ${source.status})`);
    }
    const [stepRows] = (await this.pool.query(
      `SELECT stepKey, metadata FROM ai_direct_workflow_run_steps WHERE runId = ? ORDER BY sequence ASC`,
      [runId],
    )) as any;
    const initialSteps = (stepRows as any[]).map((s) => ({
      stepKey: s.stepKey,
      metadata: s.metadata ? (typeof s.metadata === 'string' ? JSON.parse(s.metadata) : s.metadata) : undefined,
    }));
    const result = await this.enqueue({
      organizationId: source.organizationId,
      employmentId: source.employmentId,
      agentVersionId: source.agentVersionId,
      workflowKey: source.workflowKey,
      workflowVersion: source.workflowVersion ?? undefined,
      requestedByUserId: actorUserId,
      approvalId: source.approvalId,
      requestedModelPolicy: source.requestedModelPolicy
        ? typeof source.requestedModelPolicy === 'string'
          ? JSON.parse(source.requestedModelPolicy)
          : source.requestedModelPolicy
        : null,
      inputSummary: source.inputSummary
        ? typeof source.inputSummary === 'string'
          ? JSON.parse(source.inputSummary)
          : source.inputSummary
        : null,
      initialSteps,
    });
    return { runId: result.runId };
  }

  /**
   * Refresh a worker's lease. Call periodically from the worker process.
   */
  async heartbeat(runId: string, workerId: string): Promise<{ renewed: boolean }> {
    const [result] = (await this.pool.query(
      `UPDATE ai_direct_workflow_runs
       SET leaseExpiresAt = ?, updatedAt = NOW()
       WHERE id = ? AND status = 'active' AND leaseOwner = ?`,
      [nowPlus(LEASE_TTL_SECONDS), runId, workerId],
    )) as any;
    return { renewed: Number(result?.affectedRows ?? 0) > 0 };
  }
}