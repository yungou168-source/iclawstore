import { describe, expect, it, vi } from "bun:test";
import { ErrorCodes } from "../src/services/aiDirectErrors.js";
import { delegateApproval } from "../src/services/approvalDelegation.js";

type HarnessOptions = {
  status?: string;
  actorRole?: string | null;
  targetStatus?: string | null;
  updateAffectedRows?: number;
};

function makeHarness(options: HarnessOptions = {}) {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const approval = {
    id: "approval-1",
    organizationId: "org-1",
    targetType: "offer",
    targetId: "offer-1",
    requestedByUserId: "requester-1",
    approverUserId: "old-approver",
    status: options.status ?? "pending",
    expiresAt: null,
    isDue: false,
  };
  const connection = {
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
    release: vi.fn(),
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      if (sql.includes("FROM ai_direct_approvals") && sql.includes("FOR UPDATE")) {
        return [[approval], []];
      }
      if (sql.includes("FROM ai_direct_organization_members")) {
        const userId = values?.[1];
        if (userId === "admin-1") {
          return [
            options.actorRole === null
              ? []
              : [{ role: options.actorRole ?? "admin", status: "active" }],
            [],
          ];
        }
        return [
          options.targetStatus === null
            ? []
            : [{ role: "member", status: options.targetStatus ?? "active" }],
          [],
        ];
      }
      if (sql.startsWith("UPDATE ai_direct_approvals")) {
        return [{ affectedRows: options.updateAffectedRows ?? 1 }, []];
      }
      if (sql.includes("MAX(sequence)")) return [[{ nextSequence: 1 }], []];
      return [{ affectedRows: 1 }, []];
    }),
  };
  return {
    pool: { getConnection: vi.fn(async () => connection) },
    connection,
    queries,
  };
}

const input = {
  approvalId: "approval-1",
  actorUserId: "admin-1",
  toUserId: "new-approver",
  requestId: "delegate-request-1",
  reason: "load balancing",
};

describe("approval delegation transaction", () => {
  it("atomically delegates and writes immutable governance records", async () => {
    const { pool, connection, queries } = makeHarness();
    const result = await delegateApproval(pool as any, input);

    expect(result).toMatchObject({
      approvalId: "approval-1",
      fromUserId: "old-approver",
      toUserId: "new-approver",
    });
    expect(
      queries.some(({ sql }) => sql.includes("INSERT INTO ai_direct_approval_delegations")),
    ).toBe(true);
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

  it("rejects a terminal approval before authorization or governance writes", async () => {
    const { pool, connection, queries } = makeHarness({ status: "approved" });
    await expect(delegateApproval(pool as any, input)).rejects.toMatchObject({
      code: ErrorCodes.INVALID_TRANSITION,
    });

    expect(queries.some(({ sql }) => sql.includes("FROM ai_direct_organization_members"))).toBe(
      false,
    );
    expect(
      queries.some(({ sql }) => sql.includes("INSERT INTO ai_direct_approval_delegations")),
    ).toBe(false);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  it("rolls back when the target is no longer an active member after locking", async () => {
    const { pool, connection, queries } = makeHarness({ targetStatus: "inactive" });
    await expect(delegateApproval(pool as any, input)).rejects.toMatchObject({
      code: ErrorCodes.FORBIDDEN_SCOPE,
    });

    expect(
      queries.some(({ sql }) => sql.includes("INSERT INTO ai_direct_approval_delegations")),
    ).toBe(false);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it("rolls back all delegation writes when the conditional assignment loses", async () => {
    const { pool, connection, queries } = makeHarness({ updateAffectedRows: 0 });
    await expect(delegateApproval(pool as any, input)).rejects.toMatchObject({
      code: ErrorCodes.INVALID_TRANSITION,
    });

    expect(
      queries.some(({ sql }) => sql.includes("INSERT INTO ai_direct_approval_delegations")),
    ).toBe(true);
    expect(queries.some(({ sql }) => sql.includes("INSERT INTO ai_direct_approval_events"))).toBe(
      false,
    );
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });
});
