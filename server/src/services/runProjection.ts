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
import { RUN_STATUSES, type RunStatus, type StepStatus } from './jobQueue.js';

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

export type RunCursor = Readonly<{
  createdAt: string;
  runId: string;
}>;

export type RunPage = Readonly<{
  items: RunSummary[];
  nextCursor: string | null;
}>;

export const encodeRunCursor = (cursor: RunCursor): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

export function decodeRunCursor(value: string | undefined): RunCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<RunCursor>;
    if (typeof parsed.createdAt !== 'string' || typeof parsed.runId !== 'string' || !parsed.runId) {
      return null;
    }
    const createdAt = new Date(parsed.createdAt);
    if (!Number.isFinite(createdAt.getTime())) return null;
    return { createdAt: createdAt.toISOString(), runId: parsed.runId };
  } catch {
    return null;
  }
}

function asIsoDate(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function runSummary(row: any): RunSummary {
  return {
    runId: row.runId,
    workflowKey: row.workflowKey,
    status: row.status as RunStatus,
    requestedByUserId: row.requestedByUserId,
    employmentId: row.employmentId,
    agentVersionId: row.agentVersionId,
    stepCount: Number(row.stepCount ?? 0),
    completedSteps: Number(row.completedSteps ?? 0),
    failedSteps: Number(row.failedSteps ?? 0),
    createdAt: asIsoDate(row.createdAt),
    startedAt: row.startedAt ? asIsoDate(row.startedAt) : null,
    finishedAt: row.finishedAt ? asIsoDate(row.finishedAt) : null,
    failureCode: row.failureCode ?? null,
  };
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
    return (rows as any[]).map(runSummary);
  }

  async listRuns(
    organizationId: string,
    input: Readonly<{ limit: number; cursor: RunCursor | null; statuses: readonly RunStatus[] }>,
  ): Promise<RunPage> {
    const limit = Math.min(Math.max(input.limit, 1), 50);
    const statuses = input.statuses.length ? input.statuses : RUN_STATUSES;
    const placeholders = statuses.map(() => '?').join(', ');
    const params: unknown[] = [organizationId, ...statuses];
    const cursorClause = input.cursor
      ? ' AND (r.createdAt < ? OR (r.createdAt = ? AND r.id < ?))'
      : '';
    if (input.cursor) {
      const createdAt = new Date(input.cursor.createdAt);
      params.push(createdAt, createdAt, input.cursor.runId);
    }
    params.push(limit + 1);
    const [rows] = (await this.pool.query(
      `SELECT r.id AS runId, r.workflowKey, r.status, r.requestedByUserId,
              r.employmentId, r.agentVersionId, r.failureCode,
              r.createdAt, r.startedAt, r.finishedAt,
              (SELECT COUNT(*) FROM ai_direct_workflow_run_steps s WHERE s.runId = r.id) AS stepCount,
              (SELECT COUNT(*) FROM ai_direct_workflow_run_steps s WHERE s.runId = r.id AND s.status = 'succeeded') AS completedSteps,
              (SELECT COUNT(*) FROM ai_direct_workflow_run_steps s WHERE s.runId = r.id AND s.status = 'failed') AS failedSteps
       FROM ai_direct_workflow_runs r
       WHERE r.organizationId = ? AND r.status IN (${placeholders})${cursorClause}
       ORDER BY r.createdAt DESC, r.id DESC
       LIMIT ?`,
      params,
    )) as any;
    const pageRows = (rows as any[]).slice(0, limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(runSummary),
      nextCursor: (rows as any[]).length > limit && last
        ? encodeRunCursor({ createdAt: asIsoDate(last.createdAt), runId: last.runId })
        : null,
    };
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