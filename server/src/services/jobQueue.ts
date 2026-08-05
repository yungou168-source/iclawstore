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

import { createHash, randomUUID } from 'node:crypto';
import { Pool, PoolConnection } from 'mysql2/promise';
import type { ProviderFailureClass } from '../contracts/modelProvider.js';

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
  idempotencyKey?: string | null;
  initialSteps: Array<{ stepKey: string; metadata?: Record<string, unknown> }>;
}

export interface ArtifactInput {
  kind: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  visibility: 'organization' | 'requester';
}

export interface ModelExecutionAuditInput {
  agentId: string;
  agentVersionId: string;
  catalogModelId: string;
  modelKey: string;
  providerKey: string;
  credentialVersion: number;
  providerRequestId?: string;
  attempt: number;
  taskType: string;
  inputTokens?: number;
  outputTokens?: number;
  costMicros?: number | bigint;
  latencyMs?: number;
  routingMetadata?: Record<string, unknown>;
}

export interface ProviderFailureInput {
  code: string;
  reason?: string;
  failureClass: ProviderFailureClass;
  retryAfterMs?: number;
  modelAudit?: Omit<ModelExecutionAuditInput, 'inputTokens' | 'outputTokens' | 'costMicros'>;
}

export interface RunContext {
  runId: string;
  organizationId: string | null;
  agentVersionId: string | null;
  requestedByUserId: string;
  workflowKey: string;
  status: RunStatus;
  stepCount: number;
  currentStep: StepContext;
  startedAt: Date | null;
  finishedAt: Date | null;
  payload: Record<string, unknown>;
}

export interface StepContext {
  stepId: string;
  stepKey: string;
  sequence: number;
  status: StepStatus;
  attempt: number;
  maxAttempts: number;
  metadata: Record<string, unknown>;
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

async function writeModelAudit(
  conn: PoolConnection,
  runId: string,
  stepId: string,
  status: 'succeeded' | 'failed',
  audit: ModelExecutionAuditInput,
  failure?: Pick<ProviderFailureInput, 'code' | 'failureClass'>,
): Promise<void> {
  await conn.query(
    `INSERT INTO ai_direct_model_run_audits
     (id, runId, stepId, agentId, agentVersionId, catalogModelId, modelKey,
      providerKey, credentialVersion, providerRequestId, attempt, taskType, status,
      failureCode, failureClass, inputTokens, outputTokens, costMicros, latencyMs, routingMetadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [
      randomUUID(),
      runId,
      stepId,
      audit.agentId,
      audit.agentVersionId,
      audit.catalogModelId,
      audit.modelKey,
      audit.providerKey,
      audit.credentialVersion,
      audit.providerRequestId ?? null,
      audit.attempt,
      audit.taskType,
      status,
      failure?.code ?? null,
      failure?.failureClass ?? null,
      audit.inputTokens ?? null,
      audit.outputTokens ?? null,
      audit.costMicros ?? null,
      audit.latencyMs ?? null,
      JSON.stringify(audit.routingMetadata ?? {}),
    ],
  );
}

async function refreshRunUsage(conn: PoolConnection, runId: string): Promise<void> {
  await conn.query(
    `UPDATE ai_direct_workflow_runs r
     SET r.tokenUsage = JSON_OBJECT(
           'inputTokens', COALESCE((SELECT SUM(s.inputTokens) FROM ai_direct_workflow_run_steps s WHERE s.runId = r.id), 0),
           'outputTokens', COALESCE((SELECT SUM(s.outputTokens) FROM ai_direct_workflow_run_steps s WHERE s.runId = r.id), 0)),
         r.costMicros = COALESCE((SELECT SUM(s.costMicros) FROM ai_direct_workflow_run_steps s WHERE s.runId = r.id), 0),
         r.latencyMs = COALESCE((SELECT SUM(s.latencyMs) FROM ai_direct_workflow_run_steps s WHERE s.runId = r.id), 0),
         r.modelRunAuditIds = COALESCE((
           SELECT JSON_ARRAYAGG(a.id) FROM ai_direct_model_run_audits a WHERE a.runId = r.id
         ), JSON_ARRAY())
     WHERE r.id = ?`,
    [runId],
  );
}

async function incrementProviderMetric(
  conn: PoolConnection,
  providerKey: string,
  outcome: string,
): Promise<void> {
  const normalized = `${providerKey}:${outcome}`;
  if (!/^[A-Za-z0-9._:-]{1,96}$/.test(normalized)) return;
  await conn.query(
    `INSERT INTO ai_direct_runtime_metrics (metricKey, metricValue)
     VALUES (?, 1) ON DUPLICATE KEY UPDATE metricValue = metricValue + 1`,
    [`provider_calls_total:${normalized}`],
  );
}

function retryableFailure(failureClass: ProviderFailureClass): boolean {
  return failureClass === 'timeout'
    || failureClass === 'network'
    || failureClass === 'provider_5xx'
    || failureClass === 'rate_limit';
}

function retryDelayMs(
  runId: string,
  stepId: string,
  attempt: number,
  retryAfterMs?: number,
): number {
  const base = Math.min(1_000 * 2 ** Math.max(0, attempt - 1), 300_000);
  const hash = createHash('sha256').update(`${runId}:${stepId}:${attempt}`).digest();
  const jitter = hash.readUInt16BE(0) / 0xffff;
  return Math.min(Math.max(retryAfterMs ?? 0, Math.round(base * (0.75 + jitter * 0.5))), 3_600_000);
}

export function decideProviderFailure(input: Readonly<{
  runId: string;
  stepId: string;
  attempt: number;
  maxAttempts: number;
  failureClass: ProviderFailureClass;
  retryAfterMs?: number;
  now?: number;
}>): { retryScheduled: boolean; runAfter: Date | null } {
  const retryScheduled = retryableFailure(input.failureClass) && input.attempt < input.maxAttempts;
  return {
    retryScheduled,
    runAfter: retryScheduled
      ? new Date((input.now ?? Date.now()) + retryDelayMs(
        input.runId,
        input.stepId,
        input.attempt,
        input.retryAfterMs,
      ))
      : null,
  };
}

export async function enqueueWorkflowRun(
  conn: PoolConnection,
  input: EnqueueInput,
  requestId: string,
): Promise<{ runId: string; stepIds: string[] }> {
  if (!input.initialSteps.length) {
    throw new Error('enqueue requires at least one initial step');
  }
  const runId = randomUUID();
  const stepIds = input.initialSteps.map(() => randomUUID());
  await conn.query(
    `INSERT INTO ai_direct_workflow_runs
     (id, organizationId, employmentId, agentVersionId, workflowKey, workflowVersion,
      status, requestedByUserId, approvalId, requestedModelPolicy,
      inputSummary, runAfter, idempotencyKey)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)`,
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
      input.idempotencyKey ?? null,
    ],
  );
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
    requestId,
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
  return { runId, stepIds };
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
    const conn = await beginConn(this.pool);
    try {
      const result = await enqueueWorkflowRun(conn, input, this.requestId);
      await conn.commit();
      return result;
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
  async leaseNext(
    workerId: string,
    organizationId: string,
    capability: 'general' | 'provider' = 'general',
  ): Promise<RunContext | null> {
    const providerStep = capability === 'provider';
    const conn = await beginConn(this.pool);
    try {
      const [rows] = (await conn.query(
        `SELECT r.id, r.organizationId, r.agentVersionId, r.requestedByUserId,
                r.workflowKey, r.status, r.inputSummary
         FROM ai_direct_workflow_runs r
         WHERE r.organizationId = ? AND (
              (r.status = 'queued' AND (r.runAfter IS NULL OR r.runAfter <= NOW(3)))
           OR (r.status = 'active' AND r.leaseExpiresAt IS NOT NULL AND r.leaseExpiresAt <= NOW(3))
         )
         AND EXISTS (
           SELECT 1 FROM ai_direct_workflow_run_steps candidate
           WHERE candidate.runId = r.id
             AND (
               candidate.status = 'running'
               OR (candidate.status = 'pending'
                 AND NOT EXISTS (
                   SELECT 1 FROM ai_direct_workflow_run_steps active_step
                   WHERE active_step.runId = r.id AND active_step.status = 'running'
                 )
                 AND candidate.sequence = (
                   SELECT MIN(next_step.sequence) FROM ai_direct_workflow_run_steps next_step
                   WHERE next_step.runId = r.id AND next_step.status = 'pending'
                 ))
             )
             AND ((? = TRUE AND JSON_UNQUOTE(JSON_EXTRACT(candidate.metadata, '$.providerExecution.kind')) = 'provider')
               OR (? = FALSE AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(candidate.metadata, '$.providerExecution.kind')), '') <> 'provider'))
         )
         ORDER BY
           CASE WHEN r.status = 'queued' THEN 0 ELSE 1 END ASC,
           r.createdAt ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [organizationId, providerStep, providerStep],
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
             lastHeartbeatAt = NOW(3),
             startedAt = COALESCE(startedAt, NOW(3)),
             updatedAt = NOW(3)
         WHERE id = ?`,
        [workerId, leaseExpiresAt, row.id],
      );
      if (row.status === 'active') {
        await conn.query(
          `UPDATE ai_direct_workflow_run_steps
           SET attemptCount = attemptCount + 1
           WHERE runId = ? AND status = 'running'`,
          [row.id],
        );
        await conn.query(
          `INSERT INTO ai_direct_runtime_metrics (metricKey, metricValue)
           VALUES ('lease_recoveries_total', 1)
           ON DUPLICATE KEY UPDATE metricValue = metricValue + 1`,
        );
      }
      await conn.query(
        `UPDATE ai_direct_workflow_run_steps
         SET status = 'running',
             attemptCount = attemptCount + 1,
             startedAt = COALESCE(startedAt, NOW(3)),
             metadata = JSON_SET(COALESCE(metadata, JSON_OBJECT()),
                                  '$.leasedByWorkerId', CAST(? AS JSON))
         WHERE runId = ? AND status = 'pending'
           AND ((? = TRUE AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.providerExecution.kind')) = 'provider')
             OR (? = FALSE AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.providerExecution.kind')), '') <> 'provider'))
           AND NOT EXISTS (
             SELECT 1 FROM (
               SELECT id FROM ai_direct_workflow_run_steps
               WHERE runId = ? AND status = 'running' LIMIT 1
             ) AS running_step
           )
         ORDER BY sequence ASC
         LIMIT 1`,
        [JSON.stringify(workerId), row.id, providerStep, providerStep, row.id],
      );
      const [currentRows] = (await conn.query(
        `SELECT id, stepKey, sequence, status, attemptCount, maxAttempts, metadata
         FROM ai_direct_workflow_run_steps
         WHERE runId = ? AND status = 'running'
         ORDER BY sequence ASC LIMIT 1`,
        [row.id],
      )) as any;
      const currentStep = currentRows[0];
      if (!currentStep) {
        throw new Error(`Run ${row.id} has no runnable step`);
      }
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
        organizationId: row.organizationId,
        agentVersionId: row.agentVersionId,
        requestedByUserId: row.requestedByUserId,
        workflowKey: row.workflowKey,
        status: 'active',
        stepCount: Number(stepRows[0]?.stepCount ?? 0),
        currentStep: {
          stepId: currentStep.id,
          stepKey: currentStep.stepKey,
          sequence: Number(currentStep.sequence),
          status: currentStep.status,
          attempt: Number(currentStep.attemptCount),
          maxAttempts: Number(currentStep.maxAttempts),
          metadata: currentStep.metadata
            ? typeof currentStep.metadata === 'string'
              ? JSON.parse(currentStep.metadata)
              : currentStep.metadata
            : {},
        },
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
    workerId: string,
    output: {
      outputSummary?: Record<string, unknown>;
      tokenUsage?: { inputTokens?: number; outputTokens?: number };
      costMicros?: number | bigint;
      latencyMs?: number;
      artifacts?: ArtifactInput[];
      modelAudit?: ModelExecutionAuditInput;
    },
  ): Promise<{ runCompleted: boolean; nextStep: StepContext | null }> {
    const conn = await beginConn(this.pool);
    try {
      const [runRows] = (await conn.query(
        `SELECT status, leaseOwner, organizationId
         FROM ai_direct_workflow_runs WHERE id = ? FOR UPDATE`,
        [runId],
      )) as any;
      const run = runRows[0];
      if (!run || run.status !== 'active' || run.leaseOwner !== workerId) {
        throw new Error('Worker does not hold the active run lease');
      }
      const [stepRows] = (await conn.query(
        `SELECT id, status, attemptCount FROM ai_direct_workflow_run_steps
         WHERE runId = ? AND sequence = ? FOR UPDATE`,
        [runId, sequence],
      )) as any;
      const step = stepRows[0];
      if (!step || step.status !== 'running') {
        throw new Error('Step is not the active running step');
      }
      if (
        output.modelAudit
        && (
          output.modelAudit.attempt !== Number(step.attemptCount)
          || output.modelAudit.inputTokens !== output.tokenUsage?.inputTokens
          || output.modelAudit.outputTokens !== output.tokenUsage?.outputTokens
          || output.modelAudit.costMicros !== output.costMicros
          || output.modelAudit.latencyMs !== output.latencyMs
        )
      ) {
        throw new Error('Model audit does not match the active step result');
      }
      await conn.query(
        `UPDATE ai_direct_workflow_run_steps
         SET status = 'succeeded', finishedAt = NOW(3), outputSummary = ?,
             inputTokens = ?, outputTokens = ?, costMicros = ?, latencyMs = ?,
             catalogModelId = ?, modelKey = ?
         WHERE id = ? AND status = 'running'`,
        [
          output.outputSummary ? JSON.stringify(output.outputSummary) : null,
          output.tokenUsage?.inputTokens ?? null,
          output.tokenUsage?.outputTokens ?? null,
          output.costMicros ?? null,
          output.latencyMs ?? null,
          output.modelAudit?.catalogModelId ?? null,
          output.modelAudit?.modelKey ?? null,
          step.id,
        ],
      );
      if (output.modelAudit) {
        await writeModelAudit(conn, runId, step.id, 'succeeded', output.modelAudit);
        await incrementProviderMetric(conn, output.modelAudit.providerKey, 'succeeded');
      }
      await refreshRunUsage(conn, runId);
      for (const artifact of output.artifacts ?? []) {
        await conn.query(
          `INSERT INTO ai_direct_artifacts
           (id, organizationId, runId, stepId, kind, storagePath, storagePathHash,
            mimeType, sizeBytes, sha256, visibility, createdByWorkerId)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            randomUUID(),
            run.organizationId,
            runId,
            step.id,
            artifact.kind,
            artifact.storagePath,
            createHash('sha256').update(artifact.storagePath, 'utf8').digest('hex'),
            artifact.mimeType,
            artifact.sizeBytes,
            artifact.sha256,
            artifact.visibility,
            workerId,
          ],
        );
      }
      const [nextRows] = (await conn.query(
        `SELECT id, stepKey, sequence, attemptCount, maxAttempts, metadata FROM ai_direct_workflow_run_steps
         WHERE runId = ? AND status = 'pending'
         ORDER BY sequence ASC LIMIT 1 FOR UPDATE`,
        [runId],
      )) as any;
      const next = nextRows[0];
      if (next) {
        await conn.query(
          `UPDATE ai_direct_workflow_runs
           SET status = 'queued', runAfter = NULL, leaseOwner = NULL,
               leaseExpiresAt = NULL, lastHeartbeatAt = NOW(3), updatedAt = NOW(3)
           WHERE id = ? AND status = 'active' AND leaseOwner = ?`,
          [runId, workerId],
        );
        await conn.commit();
        return {
          runCompleted: false,
          nextStep: {
            stepId: next.id,
            stepKey: next.stepKey,
            sequence: Number(next.sequence),
            status: 'pending',
            attempt: Number(next.attemptCount),
            maxAttempts: Number(next.maxAttempts),
            metadata: next.metadata
              ? typeof next.metadata === 'string'
                ? JSON.parse(next.metadata)
                : next.metadata
              : {},
          },
        };
      }
      await conn.query(
        `UPDATE ai_direct_workflow_runs
         SET status = 'succeeded', finishedAt = NOW(3), leaseOwner = NULL,
             leaseExpiresAt = NULL, updatedAt = NOW(3)
         WHERE id = ? AND status = 'active' AND leaseOwner = ?`,
        [runId, workerId],
      );
      await writeAudit(conn, {
        organizationId: run.organizationId,
        actorUserId: `worker:${workerId}`,
        action: 'workflow_run.succeeded',
        targetType: 'workflow_run',
        targetId: runId,
        requestId: this.requestId,
      });
      await publishOutboxEvent(conn, {
        organizationId: run.organizationId,
        aggregateType: 'workflow_run',
        aggregateId: runId,
        eventType: 'workflow_run.succeeded.v1',
        payload: { runId, workerId },
      });
      await conn.commit();
      return { runCompleted: true, nextStep: null };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Report a provider step failure. Retryable classes return the step to pending
   * with runAfter backoff; terminal classes close both step and run.
   */
  async failStep(
    runId: string,
    sequence: number,
    workerId: string,
    failure: ProviderFailureInput,
  ): Promise<{ retryScheduled: boolean; runAfter: Date | null }> {
    const conn = await beginConn(this.pool);
    try {
      const [runRows] = (await conn.query(
        `SELECT status, leaseOwner, organizationId
         FROM ai_direct_workflow_runs WHERE id = ? FOR UPDATE`,
        [runId],
      )) as any;
      const run = runRows[0];
      if (!run || run.status !== 'active' || run.leaseOwner !== workerId) {
        throw new Error('Worker does not hold the active run lease');
      }
      const [stepRows] = (await conn.query(
        `SELECT id, status, attemptCount, maxAttempts
         FROM ai_direct_workflow_run_steps
         WHERE runId = ? AND sequence = ? FOR UPDATE`,
        [runId, sequence],
      )) as any;
      const step = stepRows[0];
      if (!step || step.status !== 'running') {
        throw new Error('Step is not the active running step');
      }
      if (failure.modelAudit && failure.modelAudit.attempt !== Number(step.attemptCount)) {
        throw new Error('Model audit does not match the active step attempt');
      }

      if (failure.modelAudit) {
        await writeModelAudit(conn, runId, step.id, 'failed', failure.modelAudit, failure);
        await incrementProviderMetric(conn, failure.modelAudit.providerKey, failure.failureClass);
      }
      const decision = decideProviderFailure({
        runId,
        stepId: step.id,
        attempt: Number(step.attemptCount),
        maxAttempts: Number(step.maxAttempts),
        failureClass: failure.failureClass,
        retryAfterMs: failure.retryAfterMs,
      });
      const { retryScheduled, runAfter } = decision;

      if (retryScheduled) {
        await conn.query(
          `UPDATE ai_direct_workflow_run_steps
           SET status = 'pending', finishedAt = NULL, failureCode = ?, lastFailureClass = ?
           WHERE id = ? AND status = 'running'`,
          [failure.code, failure.failureClass, step.id],
        );
        await conn.query(
          `UPDATE ai_direct_workflow_runs
           SET status = 'queued', runAfter = ?, failureCode = ?, failureReason = ?,
               leaseOwner = NULL, leaseExpiresAt = NULL, updatedAt = NOW(3)
           WHERE id = ? AND status = 'active' AND leaseOwner = ?`,
          [runAfter, failure.code, failure.reason ?? null, runId, workerId],
        );
        await publishOutboxEvent(conn, {
          organizationId: run.organizationId,
          aggregateType: 'workflow_run',
          aggregateId: runId,
          eventType: 'workflow_run.retry_scheduled.v1',
          payload: {
            runId,
            sequence,
            attempt: Number(step.attemptCount),
            failureClass: failure.failureClass,
            runAfter: runAfter!.toISOString(),
          },
        });
      } else {
        await conn.query(
          `UPDATE ai_direct_workflow_run_steps
           SET status = 'failed', finishedAt = NOW(3), failureCode = ?, lastFailureClass = ?
           WHERE id = ? AND status = 'running'`,
          [failure.code, failure.failureClass, step.id],
        );
        await conn.query(
          `UPDATE ai_direct_workflow_runs
           SET status = 'failed', finishedAt = NOW(3), failureCode = ?,
               failureReason = ?, leaseOwner = NULL, leaseExpiresAt = NULL, updatedAt = NOW(3)
           WHERE id = ? AND status = 'active' AND leaseOwner = ?`,
          [failure.code, failure.reason ?? null, runId, workerId],
        );
        await writeAudit(conn, {
          organizationId: run.organizationId,
          actorUserId: `worker:${workerId}`,
          action: 'workflow_run.failed',
          targetType: 'workflow_run',
          targetId: runId,
          requestId: this.requestId,
          metadata: { sequence, code: failure.code, failureClass: failure.failureClass },
        });
        await publishOutboxEvent(conn, {
          organizationId: run.organizationId,
          aggregateType: 'workflow_run',
          aggregateId: runId,
          eventType: 'workflow_run.failed.v1',
          payload: {
            runId,
            sequence,
            workerId,
            code: failure.code,
            failureClass: failure.failureClass,
          },
        });
      }
      await refreshRunUsage(conn, runId);
      await conn.commit();
      return { retryScheduled, runAfter };
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
              status, requestedByUserId, approvalId, requestedModelPolicy, inputSummary
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
       SET leaseExpiresAt = ?, lastHeartbeatAt = NOW(3), updatedAt = NOW(3)
       WHERE id = ? AND status = 'active' AND leaseOwner = ?`,
      [nowPlus(LEASE_TTL_SECONDS), runId, workerId],
    )) as any;
    return { renewed: Number(result?.affectedRows ?? 0) > 0 };
  }
}