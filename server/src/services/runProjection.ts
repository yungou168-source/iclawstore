/**
 * Run Projection Service — AI Direct Hiring P1 Runtime Center (Agent G).
 *
 * Read-side queries over `ai_direct_workflow_runs` and
 * `ai_direct_workflow_run_steps`. Used by:
 *   - `aiDirectJobs.ts` (GET /jobs, GET /jobs/:id)
 *   - Convex projection (future Agent D')
 *
 * All queries are scoped to a single companyId via `organizationId` so that
 * RBAC at the route layer can apply `requireCompanyRole('manager')`.
 */

import { randomUUID } from 'node:crypto';
import { Pool } from 'mysql2/promise';
import type { RunStatus, StepStatus } from './jobQueue.js';

export interface RunSummary {
  runId: string;
  workflowKey: string;
  status: RunStatus;
  requestedByUserId: string;
  employmentId: string | null;
  agentVersionId: string | null;
  stepCount: number;
  completedSteps: number;
  failedSteps: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  failureCode: string | null;
}

export interface StepSummary {
  stepId: string;
  stepKey: string;
  sequence: number;
  status: StepStatus;
  startedAt: string | null;
  finishedAt: string | null;
  latencyMs: number | null;
  costMicros: string | null;
  failureCode: string | null;
  outputSummary: Record<string, unknown> | null;
}

export interface RunDetailView extends RunSummary {
  steps: StepSummary[];
  inputSummary: Record<string, unknown> | null;
  outputIndex: Record<string, unknown> | null;
  failureReason: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
}

function parseJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value as T;
}

function safeBigIntToString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  return String(value);
}

export class RunProjectionService {
  constructor(private readonly pool: Pool) {}

  /**
   * Active runs for a company (status IN queued|active). Limit 100.
   * Includes a cheap step count summary.
   */
  async getActiveRuns(organizationId: string): Promise<RunSummary[]> {
    const [rows] = (await this.pool.query(
      `SELECT r.id AS runId, r.workflowKey, r.status, r.requestedByUserId,
              r.employmentId, r.agentVersionId, r.failureCode,
              r.createdAt, r.startedAt, r.finishedAt,
              (SELECT COUNT(*) FROM ai_direct_workflow_run_steps s WHERE s.runId = r.id) AS stepCount,
              (SELECT COUNT(*) FROM ai_direct_workflow_run_steps s WHERE s.runId = r.id AND s.status = 'succeeded') AS completedSteps,
              (SELECT COUNT(*) FROM ai_direct_workflow_run_steps s WHERE s.runId = r.id AND s.status = 'failed') AS failedSteps
       FROM ai_direct_workflow_runs r
       WHERE r.organizationId = ? AND r.status IN ('queued', 'active')
       ORDER BY r.createdAt DESC
       LIMIT 100`,
      [organizationId],
    )) as any;
    return (rows as any[]).map((row) => ({
      runId: row.runId,
      workflowKey: row.workflowKey,
      status: row.status as RunStatus,
      requestedByUserId: row.requestedByUserId,
      employmentId: row.employmentId,
      agentVersionId: row.agentVersionId,
      stepCount: Number(row.stepCount ?? 0),
      completedSteps: Number(row.completedSteps ?? 0),
      failedSteps: Number(row.failedSteps ?? 0),
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      startedAt: row.startedAt instanceof Date ? row.startedAt.toISOString() : row.startedAt ? String(row.startedAt) : null,
      finishedAt: row.finishedAt instanceof Date ? row.finishedAt.toISOString() : row.finishedAt ? String(row.finishedAt) : null,
      failureCode: row.failureCode ?? null,
    }));
  }

  /**
   * Detail view of a single run including all its steps. Returns null when
   * the run does not exist or is not visible to the given organization.
   */
  async getRun(runId: string, organizationId?: string): Promise<RunDetailView | null> {
    const runParams: unknown[] = [runId];
    let orgClause = '';
    if (organizationId !== undefined) {
      orgClause = ' AND organizationId = ?';
      runParams.push(organizationId);
    }
    const [runRows] = (await this.pool.query(
      `SELECT id, organizationId, workflowKey, status, requestedByUserId,
              employmentId, agentVersionId, approvalId, failureCode, failureReason,
              inputSummary, outputIndex, leaseOwner, leaseExpiresAt,
              createdAt, startedAt, finishedAt
       FROM ai_direct_workflow_runs
       WHERE id = ?${orgClause}
       LIMIT 1`,
      runParams,
    )) as any;
    const row = (runRows as any[])[0];
    if (!row) return null;
    const [stepRows] = (await this.pool.query(
      `SELECT id, stepKey, sequence, status, startedAt, finishedAt, latencyMs,
              costMicros, failureCode, outputSummary
       FROM ai_direct_workflow_run_steps
       WHERE runId = ?
       ORDER BY sequence ASC`,
      [runId],
    )) as any;
    const steps: StepSummary[] = (stepRows as any[]).map((s) => ({
      stepId: s.id,
      stepKey: s.stepKey,
      sequence: Number(s.sequence),
      status: s.status as StepStatus,
      startedAt: s.startedAt instanceof Date ? s.startedAt.toISOString() : s.startedAt ? String(s.startedAt) : null,
      finishedAt: s.finishedAt instanceof Date ? s.finishedAt.toISOString() : s.finishedAt ? String(s.finishedAt) : null,
      latencyMs: s.latencyMs !== null ? Number(s.latencyMs) : null,
      costMicros: safeBigIntToString(s.costMicros),
      failureCode: s.failureCode ?? null,
      outputSummary: parseJson<Record<string, unknown>>(s.outputSummary),
    }));
    return {
      runId: row.id,
      workflowKey: row.workflowKey,
      status: row.status as RunStatus,
      requestedByUserId: row.requestedByUserId,
      employmentId: row.employmentId,
      agentVersionId: row.agentVersionId,
      stepCount: steps.length,
      completedSteps: steps.filter((s) => s.status === 'succeeded').length,
      failedSteps: steps.filter((s) => s.status === 'failed').length,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      startedAt: row.startedAt instanceof Date ? row.startedAt.toISOString() : row.startedAt ? String(row.startedAt) : null,
      finishedAt: row.finishedAt instanceof Date ? row.finishedAt.toISOString() : row.finishedAt ? String(row.finishedAt) : null,
      failureCode: row.failureCode ?? null,
      failureReason: row.failureReason ?? null,
      inputSummary: parseJson<Record<string, unknown>>(row.inputSummary),
      outputIndex: parseJson<Record<string, unknown>>(row.outputIndex),
      leaseOwner: row.leaseOwner ?? null,
      leaseExpiresAt:
        row.leaseExpiresAt instanceof Date
          ? row.leaseExpiresAt.toISOString()
          : row.leaseExpiresAt
          ? String(row.leaseExpiresAt)
          : null,
      steps,
    };
  }
}