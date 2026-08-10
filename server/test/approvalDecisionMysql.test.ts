import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createPool, type Pool } from "mysql2/promise";
import { decideApproval } from "../src/services/approvalDecision.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("approval decision MySQL transaction", () => {
  let pool: Pool;
  let sequence = 0;

  beforeAll(() => {
    pool = createPool({ uri: databaseUrl!, connectionLimit: 4 });
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function createPendingHiringIntentApproval(
    options: {
      due?: boolean;
      intentStatus?: string;
      linkedApprovalId?: string | null;
    } = {},
  ) {
    sequence += 1;
    const suffix = String(sequence).padStart(12, "0");
    const hiringIntentId = `10000000-0000-4000-8000-${suffix}`;
    const approvalId = `20000000-0000-4000-8000-${suffix}`;
    const organizationId = `30000000-0000-4000-8000-${suffix}`;
    await pool.query(
      `INSERT INTO ai_direct_hiring_intents
       (id, organizationId, companyId, projectId, roleId, positionId, agentId,
        agentVersionId, priceId, requestedByUserId, status, approvalId,
        idempotencyKey, idempotencyFingerprint)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 'mysql-requester', ?, ?, ?, ?)`,
      [
        hiringIntentId,
        organizationId,
        `40000000-0000-4000-8000-${suffix}`,
        `50000000-0000-4000-8000-${suffix}`,
        `60000000-0000-4000-8000-${suffix}`,
        `70000000-0000-4000-8000-${suffix}`,
        `80000000-0000-4000-8000-${suffix}`,
        `90000000-0000-4000-8000-${suffix}`,
        options.intentStatus ?? "pending_approval",
        options.linkedApprovalId === undefined ? approvalId : options.linkedApprovalId,
        `approval-mysql-${suffix}`,
        "a".repeat(64),
      ],
    );
    await pool.query(
      `INSERT INTO ai_direct_approvals
       (id, organizationId, targetType, targetId, requestedByUserId, status, expiresAt)
       VALUES (?, ?, 'hiring_intent', ?, 'mysql-requester', 'pending', ?)`,
      [approvalId, organizationId, hiringIntentId, options.due ? new Date(Date.now() - 60_000) : null],
    );
    return { approvalId, hiringIntentId };
  }

  it("commits rejection to the approval and cancels the linked hiring intent", async () => {
    const fixture = await createPendingHiringIntentApproval();

    await decideApproval(pool, {
      approvalId: fixture.approvalId,
      decision: "rejected",
      actorUserId: "mysql-approver",
      requestId: `mysql-reject:${fixture.approvalId}`,
      reason: "integration rejection",
    });

    const [[approval]] = await pool.query<any[]>(
      "SELECT status, decision, decisionReason FROM ai_direct_approvals WHERE id = ?",
      [fixture.approvalId],
    );
    const [[intent]] = await pool.query<any[]>(
      "SELECT status FROM ai_direct_hiring_intents WHERE id = ?",
      [fixture.hiringIntentId],
    );
    const [[counts]] = await pool.query<any[]>(
      `SELECT
         (SELECT COUNT(*) FROM ai_direct_approval_events WHERE approvalId = ?) AS eventCount,
         (SELECT COUNT(*) FROM ai_direct_audit_events WHERE targetType = 'approval' AND targetId = ?) AS auditCount,
         (SELECT COUNT(*) FROM ai_direct_outbox_events WHERE aggregateType = 'approval' AND aggregateId = ?) AS outboxCount,
         (SELECT COUNT(*) FROM ai_direct_offers WHERE approvalId = ?) AS offerCount`,
      [fixture.approvalId, fixture.approvalId, fixture.approvalId, fixture.approvalId],
    );

    expect(approval).toMatchObject({
      status: "rejected",
      decision: "rejected",
      decisionReason: "integration rejection",
    });
    expect(intent.status).toBe("cancelled");
    expect(counts).toMatchObject({ eventCount: 1, auditCount: 1, outboxCount: 1, offerCount: 0 });
  });

  it("commits cancellation to the approval and cancels the linked hiring intent", async () => {
    const fixture = await createPendingHiringIntentApproval();

    await decideApproval(pool, {
      approvalId: fixture.approvalId,
      decision: "cancelled",
      actorUserId: "mysql-requester",
      requestId: `mysql-cancel:${fixture.approvalId}`,
    });

    const [[approval]] = await pool.query<any[]>(
      "SELECT status, decision FROM ai_direct_approvals WHERE id = ?",
      [fixture.approvalId],
    );
    const [[intent]] = await pool.query<any[]>(
      "SELECT status FROM ai_direct_hiring_intents WHERE id = ?",
      [fixture.hiringIntentId],
    );
    expect(approval).toMatchObject({ status: "cancelled", decision: "cancelled" });
    expect(intent.status).toBe("cancelled");
  });

  it("commits timeout expiry and cancels the linked hiring intent", async () => {
    const fixture = await createPendingHiringIntentApproval({ due: true });

    await decideApproval(pool, {
      approvalId: fixture.approvalId,
      decision: "expired",
      actorUserId: null,
      requestId: `approval-timeout:${fixture.approvalId}`,
      reason: "deadline_reached",
    });

    const [[approval]] = await pool.query<any[]>(
      "SELECT status, decision FROM ai_direct_approvals WHERE id = ?",
      [fixture.approvalId],
    );
    const [[intent]] = await pool.query<any[]>(
      "SELECT status FROM ai_direct_hiring_intents WHERE id = ?",
      [fixture.hiringIntentId],
    );
    expect(approval).toMatchObject({ status: "expired", decision: "expired" });
    expect(intent.status).toBe("cancelled");
  });

  it("rolls back cancellation and governance writes when the hiring-intent link is invalid", async () => {
    const fixture = await createPendingHiringIntentApproval({ linkedApprovalId: null });

    await expect(
      decideApproval(pool, {
        approvalId: fixture.approvalId,
        decision: "cancelled",
        actorUserId: "mysql-requester",
        requestId: `mysql-cancel-rollback:${fixture.approvalId}`,
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });

    const [[approval]] = await pool.query<any[]>(
      "SELECT status, decision, decidedAt FROM ai_direct_approvals WHERE id = ?",
      [fixture.approvalId],
    );
    const [[intent]] = await pool.query<any[]>(
      "SELECT status FROM ai_direct_hiring_intents WHERE id = ?",
      [fixture.hiringIntentId],
    );
    const [[counts]] = await pool.query<any[]>(
      `SELECT
         (SELECT COUNT(*) FROM ai_direct_approval_events WHERE approvalId = ?) AS eventCount,
         (SELECT COUNT(*) FROM ai_direct_audit_events WHERE targetType = 'approval' AND targetId = ?) AS auditCount,
         (SELECT COUNT(*) FROM ai_direct_outbox_events WHERE aggregateType = 'approval' AND aggregateId = ?) AS outboxCount`,
      [fixture.approvalId, fixture.approvalId, fixture.approvalId],
    );
    expect(approval).toMatchObject({ status: "pending", decision: null, decidedAt: null });
    expect(intent.status).toBe("pending_approval");
    expect(counts).toMatchObject({ eventCount: 0, auditCount: 0, outboxCount: 0 });
  });

  it("reuses the transaction connection for locked-state authorization", async () => {
    const singleConnectionPool = createPool({ uri: databaseUrl!, connectionLimit: 1 });
    const fixture = await createPendingHiringIntentApproval();
    try {
      await decideApproval(singleConnectionPool, {
        approvalId: fixture.approvalId,
        decision: "approved",
        actorUserId: "mysql-approver",
        requestId: `mysql-authorize:${fixture.approvalId}`,
        authorize: async (approval, connection) => {
          const [[row]] = await connection.query<any[]>(
            "SELECT status FROM ai_direct_approvals WHERE id = ?",
            [approval.id],
          );
          expect(row.status).toBe("pending");
        },
      });
    } finally {
      await singleConnectionPool.end();
    }

    const [[intent]] = await pool.query<any[]>(
      "SELECT status FROM ai_direct_hiring_intents WHERE id = ?",
      [fixture.hiringIntentId],
    );
    expect(intent.status).toBe("awaiting_payment");
  });

  it("allows only one winner among cancellation, manual approval, and timeout expiry", async () => {
    const fixture = await createPendingHiringIntentApproval({ due: true });

    const results = await Promise.allSettled([
      decideApproval(pool, {
        approvalId: fixture.approvalId,
        decision: "cancelled",
        actorUserId: "mysql-requester",
        requestId: `mysql-cancel:${fixture.approvalId}`,
      }),
      decideApproval(pool, {
        approvalId: fixture.approvalId,
        decision: "approved",
        actorUserId: "mysql-approver",
        requestId: `mysql-approve:${fixture.approvalId}`,
      }),
      decideApproval(pool, {
        approvalId: fixture.approvalId,
        decision: "expired",
        actorUserId: null,
        requestId: `approval-timeout:${fixture.approvalId}`,
        reason: "deadline_reached",
      }),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(2);
    const [[approval]] = await pool.query<any[]>(
      "SELECT status FROM ai_direct_approvals WHERE id = ?",
      [fixture.approvalId],
    );
    const [[intent]] = await pool.query<any[]>(
      "SELECT status FROM ai_direct_hiring_intents WHERE id = ?",
      [fixture.hiringIntentId],
    );
    const [[eventCount]] = await pool.query<any[]>(
      "SELECT COUNT(*) AS count FROM ai_direct_approval_events WHERE approvalId = ?",
      [fixture.approvalId],
    );
    expect(["cancelled", "approved", "expired"]).toContain(approval.status);
    const intentStatusByDecision: Record<string, string> = {
      cancelled: "cancelled",
      approved: "awaiting_payment",
      expired: "cancelled",
    };
    expect(intent.status).toBe(intentStatusByDecision[approval.status]);
    expect(eventCount.count).toBe(1);
  });
});
