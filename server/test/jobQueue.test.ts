/**
 * Unit tests for the JobQueueService (Agent G — P1 Runtime Center).
 *
 * Tests cover the pure-logic parts of the queue that don't depend on a
 * real MySQL FOR UPDATE/SKIP LOCKED behavior:
 *   - status constants and terminal checks
 *   - lease strategy docs: queued-or-expired-active selection
 *   - retry() rebuilds the initial step set from a source run
 *   - heartbeat() returns {renewed: false} when workerId doesn't match
 *
 * Run with:  bun test server/test/jobQueue.test.ts
 */

import { describe, expect, it, vi } from "bun:test";
import { randomUUID } from "node:crypto";
import { JobQueueService, RUN_STATUSES, type EnqueueInput } from "../src/services/jobQueue.js";

function makeMockPool(
  scenario: {
    sourceRows?: any[];
    sourceSteps?: any[];
    updateResult?: { affectedRows: number };
  } = {},
) {
  const inserts: any[] = [];
  const updates: any[] = [];
  const pool = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("INSERT INTO ai_direct_workflow_runs")) {
        inserts.push({ kind: "run", values });
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes("INSERT INTO ai_direct_workflow_run_steps")) {
        inserts.push({ kind: "step", values });
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes("INSERT INTO ai_direct_audit_events")) {
        inserts.push({ kind: "audit", values });
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes("INSERT INTO ai_direct_outbox_events")) {
        inserts.push({ kind: "outbox", values });
        return [{ affectedRows: 1 }, []];
      }
      if (sql.startsWith("SELECT") && sql.includes("FROM ai_direct_workflow_runs")) {
        if (scenario.sourceRows !== undefined) {
          return [scenario.sourceRows, []];
        }
        return [[], []];
      }
      if (sql.startsWith("SELECT") && sql.includes("FROM ai_direct_workflow_run_steps")) {
        if (scenario.sourceSteps !== undefined) {
          return [scenario.sourceSteps, []];
        }
        return [[], []];
      }
      if (sql.includes("UPDATE ai_direct_workflow_runs")) {
        updates.push({ sql, values });
        if (scenario.updateResult) {
          return [scenario.updateResult, []];
        }
        return [{ affectedRows: 1 }, []];
      }
      return [[], []];
    }),
    getConnection: vi.fn(async () => ({
      query: pool.query,
      beginTransaction: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
      release: vi.fn(),
    })),
  };
  return { pool, inserts, updates };
}

describe("JobQueueService — status constants", () => {
  it("includes all five canonical statuses", () => {
    expect(RUN_STATUSES).toEqual(["queued", "active", "succeeded", "failed", "cancelled"]);
  });
});

describe("JobQueueService.enqueue", () => {
  it("requires at least one initial step", async () => {
    const { pool } = makeMockPool();
    const service = new JobQueueService(pool as any);
    const input: EnqueueInput = {
      workflowKey: "test.workflow",
      organizationId: null,
      requestedByUserId: "user-1",
      initialSteps: [],
    };
    await expect(service.enqueue(input)).rejects.toThrow(
      "enqueue requires at least one initial step",
    );
  });

  it("writes a run + N steps + audit + outbox rows in a single transaction", async () => {
    const { pool, inserts } = makeMockPool();
    const service = new JobQueueService(pool as any);
    const result = await service.enqueue({
      workflowKey: "test.workflow",
      organizationId: "org-1",
      requestedByUserId: "user-1",
      initialSteps: [
        { stepKey: "step.one" },
        { stepKey: "step.two", metadata: { source: "unit-test" } },
      ],
    });
    expect(result.runId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.stepIds).toHaveLength(2);
    const kinds = inserts.map((i) => i.kind);
    expect(kinds).toContain("run");
    expect(kinds.filter((k) => k === "step")).toHaveLength(2);
    expect(kinds).toContain("audit");
    expect(kinds).toContain("outbox");
  });
});

describe("JobQueueService.heartbeat", () => {
  it("returns renewed=true when update affects a row", async () => {
    const { pool } = makeMockPool({ updateResult: { affectedRows: 1 } });
    const service = new JobQueueService(pool as any);
    const result = await service.heartbeat("run-1", "worker-1");
    expect(result.renewed).toBe(true);
  });

  it("returns renewed=false when no row matches the (runId, workerId) pair", async () => {
    const { pool } = makeMockPool({ updateResult: { affectedRows: 0 } });
    const service = new JobQueueService(pool as any);
    const result = await service.heartbeat("run-1", "worker-WRONG");
    expect(result.renewed).toBe(false);
  });
});

describe("JobQueueService.retry", () => {
  it("rejects retry on a still-active run", async () => {
    const { pool } = makeMockPool({
      sourceRows: [
        {
          organizationId: "org-1",
          status: "active",
          inputSummary: null,
          requestedModelPolicy: null,
        },
      ],
    });
    const service = new JobQueueService(pool as any);
    await expect(service.retry("run-active", "user-1")).rejects.toThrow(/failed\/terminal/i);
  });

  it("clones a failed run with the same step keys", async () => {
    const { pool, inserts } = makeMockPool({
      sourceRows: [
        {
          organizationId: "org-1",
          employmentId: null,
          agentVersionId: null,
          workflowKey: "agent.evaluate",
          workflowVersion: "v1",
          status: "failed",
          requestedByUserId: "user-1",
          approvalId: null,
          requestedModelPolicy: null,
          inputSummary: JSON.stringify({ prompt: "hi" }),
        },
      ],
      sourceSteps: [
        { stepKey: "resolve.model", metadata: null },
        { stepKey: "invoke.model", metadata: JSON.stringify({ attempt: 1 }) },
      ],
    });
    const service = new JobQueueService(pool as any);
    const result = await service.retry("run-failed", "user-2");
    expect(result.runId).toMatch(/^[0-9a-f-]{36}$/i);
    const stepInserts = inserts.filter((i) => i.kind === "step");
    expect(stepInserts).toHaveLength(2);
    expect(stepInserts[0].values[2]).toBe("resolve.model");
    expect(stepInserts[1].values[2]).toBe("invoke.model");
  });
});
