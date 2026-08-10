import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createPool, type Pool } from "mysql2/promise";
import { JobQueueService } from "../src/services/jobQueue.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("Worker runtime MySQL lease and artifact closure", () => {
  let pool: Pool;
  let queue: JobQueueService;
  let runId: string;

  beforeAll(async () => {
    pool = createPool({ uri: databaseUrl!, connectionLimit: 2 });
    for (const table of [
      "ai_direct_artifacts",
      "ai_direct_workflow_run_steps",
      "ai_direct_workflow_runs",
      "ai_direct_outbox_events",
      "ai_direct_runtime_metrics",
    ]) {
      await pool.query(`DELETE FROM ${table}`);
    }
    queue = new JobQueueService(pool, "worker-runtime-test");
    runId = (
      await queue.enqueue({
        organizationId: "organization-1",
        workflowKey: "worker.runtime.test",
        workflowVersion: "v1",
        requestedByUserId: "owner-1",
        initialSteps: [{ stepKey: "step.one" }, { stepKey: "step.two" }],
      })
    ).runId;
    await queue.enqueue({
      organizationId: "organization-2",
      workflowKey: "worker.runtime.other-org",
      requestedByUserId: "owner-2",
      initialSteps: [{ stepKey: "other.step" }],
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("leases only within the worker organization and exposes the current step", async () => {
    const lease = await queue.leaseNext("worker-1", "organization-1");
    expect(lease).not.toBeNull();
    expect(lease?.runId).toBe(runId);
    expect(lease?.currentStep).toMatchObject({
      stepKey: "step.one",
      sequence: 1,
      status: "running",
    });

    const otherLease = await queue.leaseNext("worker-1", "organization-missing");
    expect(otherLease).toBeNull();
  });

  it("rejects a non-owner and advances one step with artifact metadata atomically", async () => {
    await expect(queue.completeStep(runId, 1, "worker-2", {})).rejects.toThrow(
      "Worker does not hold the active run lease",
    );

    const completion = await queue.completeStep(runId, 1, "worker-1", {
      outputSummary: { ok: true },
      artifacts: [
        {
          kind: "report",
          storagePath: "organization-1/run/report.json",
          mimeType: "application/json",
          sizeBytes: 42,
          sha256: "a".repeat(64),
          visibility: "organization",
        },
      ],
    });
    expect(completion).toMatchObject({
      runCompleted: false,
      nextStep: { stepKey: "step.two", sequence: 2, status: "pending" },
    });
    const secondLease = await queue.leaseNext("worker-1", "organization-1");
    expect(secondLease?.currentStep).toMatchObject({
      stepKey: "step.two",
      sequence: 2,
      status: "running",
    });

    const [artifacts] = await pool.query(
      `SELECT runId, kind, storagePath, createdByWorkerId FROM ai_direct_artifacts WHERE runId = ?`,
      [runId],
    );
    expect(artifacts).toEqual([
      {
        runId,
        kind: "report",
        storagePath: "organization-1/run/report.json",
        createdByWorkerId: "worker-1",
      },
    ]);
  });

  it("reclaims an expired lease without starting a duplicate step", async () => {
    await pool.query(
      `UPDATE ai_direct_workflow_runs SET leaseExpiresAt = DATE_SUB(NOW(3), INTERVAL 1 SECOND)
       WHERE id = ?`,
      [runId],
    );
    const reclaimed = await queue.leaseNext("worker-2", "organization-1");
    expect(reclaimed?.currentStep).toMatchObject({ stepKey: "step.two", sequence: 2 });

    const [running] = await pool.query(
      `SELECT sequence FROM ai_direct_workflow_run_steps WHERE runId = ? AND status = 'running'`,
      [runId],
    );
    expect(running).toEqual([{ sequence: 2 }]);
    await expect(queue.completeStep(runId, 2, "worker-1", {})).rejects.toThrow(
      "Worker does not hold the active run lease",
    );

    const completion = await queue.completeStep(runId, 2, "worker-2", {});
    expect(completion).toEqual({ runCompleted: true, nextStep: null });
    const [runs] = await pool.query(
      `SELECT status, leaseOwner FROM ai_direct_workflow_runs WHERE id = ?`,
      [runId],
    );
    expect(runs).toEqual([{ status: "succeeded", leaseOwner: null }]);
    const [metrics] = await pool.query(
      `SELECT metricValue FROM ai_direct_runtime_metrics WHERE metricKey = 'lease_recoveries_total'`,
    );
    expect(Number((metrics as any[])[0].metricValue)).toBe(1);
  });
});
