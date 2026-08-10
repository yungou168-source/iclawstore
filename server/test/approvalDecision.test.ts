import { describe, expect, it, vi } from "bun:test";
import { AiDirectHiringError, ErrorCodes } from "../src/services/aiDirectErrors.js";
import { decideApproval, type ApprovalDecision } from "../src/services/approvalDecision.js";

type HarnessOptions = {
  approvalStatus?: string;
  isDue?: boolean;
  targetType?: string;
  intentAffectedRows?: number;
  intentError?: Error;
};

function makeHarness(options: HarnessOptions = {}) {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const approval = {
    id: "approval-1",
    organizationId: "org-1",
    targetType: options.targetType ?? "hiring_intent",
    targetId: "intent-1",
    requestedByUserId: "requester-1",
    approverUserId: null,
    status: options.approvalStatus ?? "pending",
    expiresAt: new Date("2026-08-01T00:00:00.000Z"),
    isDue: options.isDue === false ? 0 : 1,
  };
  let decidedStatus = approval.status;
  const connection = {
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
    release: vi.fn(),
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      if (sql.includes("FOR UPDATE")) return [[approval], []];
      if (sql.startsWith("UPDATE ai_direct_approvals")) {
        decidedStatus = String(values?.[0]);
        return [{ affectedRows: 1 }, []];
      }
      if (sql.startsWith("UPDATE ai_direct_hiring_intents")) {
        if (options.intentError) throw options.intentError;
        return [{ affectedRows: options.intentAffectedRows ?? 1 }, []];
      }
      if (sql.includes("MAX(sequence)")) return [[{ nextSequence: 1 }], []];
      if (sql.startsWith("SELECT * FROM ai_direct_approvals")) {
        return [[{ ...approval, status: decidedStatus, decision: decidedStatus }], []];
      }
      return [{ affectedRows: 1 }, []];
    }),
  };
  const pool = { getConnection: vi.fn(async () => connection) };
  return { pool, connection, queries };
}

const expectedIntentStatus: Record<ApprovalDecision, string> = {
  approved: "awaiting_payment",
  rejected: "cancelled",
  expired: "cancelled",
  cancelled: "cancelled",
};

describe("unified approval decision transaction", () => {
  for (const decision of ["approved", "rejected", "expired", "cancelled"] as const) {
    it(`${decision} advances the linked hiring intent atomically`, async () => {
      const { pool, connection, queries } = makeHarness();
      const result = await decideApproval(pool as any, {
        approvalId: "approval-1",
        decision,
        actorUserId: decision === "expired" ? null : "approver-1",
        requestId: `request-${decision}`,
        reason: decision === "rejected" ? "not approved" : null,
      });

      expect(result.status).toBe(decision);
      const intentUpdate = queries.find(({ sql }) =>
        sql.startsWith("UPDATE ai_direct_hiring_intents"),
      );
      expect(intentUpdate?.values?.[0]).toBe(expectedIntentStatus[decision]);
      expect(intentUpdate?.values).toContain("approval-1");
      expect(queries.some(({ sql }) => sql.includes("INSERT INTO ai_direct_approval_events"))).toBe(
        true,
      );
      expect(queries.some(({ sql }) => sql.includes("INSERT INTO ai_direct_audit_events"))).toBe(
        true,
      );
      expect(queries.some(({ sql }) => sql.includes("INSERT INTO ai_direct_outbox_events"))).toBe(
        true,
      );
      expect(connection.commit).toHaveBeenCalledTimes(1);
      expect(connection.rollback).not.toHaveBeenCalled();
    });
  }

  it("does not mutate legacy Offer rows when deciding an old Offer approval", async () => {
    const { pool, connection, queries } = makeHarness({ targetType: "offer" });
    const result = await decideApproval(pool as any, {
      approvalId: "approval-1",
      decision: "cancelled",
      actorUserId: "requester-1",
      requestId: "request-cancel-legacy-offer",
    });

    expect(result.status).toBe("cancelled");
    expect(queries.some(({ sql }) => sql.includes("UPDATE ai_direct_offers"))).toBe(false);
    expect(queries.some(({ sql }) => sql.startsWith("UPDATE ai_direct_hiring_intents"))).toBe(
      false,
    );
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  it("rolls back when the linked hiring intent is no longer pending approval", async () => {
    const { pool, connection, queries } = makeHarness({ intentAffectedRows: 0 });
    await expect(
      decideApproval(pool as any, {
        approvalId: "approval-1",
        decision: "cancelled",
        actorUserId: "requester-1",
        requestId: "request-cancel",
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_TRANSITION });

    expect(queries.some(({ sql }) => sql.startsWith("UPDATE ai_direct_approvals"))).toBe(true);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it("does not swallow a linked hiring intent SQL failure", async () => {
    const databaseError = new Error("hiring intent update failed");
    const { pool, connection } = makeHarness({ intentError: databaseError });
    await expect(
      decideApproval(pool as any, {
        approvalId: "approval-1",
        decision: "expired",
        actorUserId: null,
        requestId: "approval-timeout:approval-1",
        reason: "deadline_reached",
      }),
    ).rejects.toBe(databaseError);

    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it("rejects a decision after locking a non-pending approval", async () => {
    const { pool, connection, queries } = makeHarness({ approvalStatus: "approved" });
    await expect(
      decideApproval(pool as any, {
        approvalId: "approval-1",
        decision: "cancelled",
        actorUserId: "requester-1",
        requestId: "request-cancel",
      }),
    ).rejects.toBeInstanceOf(AiDirectHiringError);

    expect(queries.some(({ sql }) => sql.startsWith("UPDATE ai_direct_approvals"))).toBe(false);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });
});
