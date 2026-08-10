import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createPool, type Pool } from "mysql2/promise";
import { authorizeApprovalAction } from "../src/services/approvalAuthorization.js";
import { decideApproval, type ApprovalDecision } from "../src/services/approvalDecision.js";
import { delegateApproval } from "../src/services/approvalDelegation.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

const organizationId = "60000000-0000-4000-8000-000000000001";
const users = {
  owner: "mysql-owner",
  admin: "mysql-admin",
  member: "mysql-member",
  requester: "mysql-requester",
  oldApprover: "mysql-old-approver",
  newApprover: "mysql-new-approver",
};

integration("approval authorization and delegation MySQL closure", () => {
  let pool: Pool;
  let sequence = 0;

  beforeAll(async () => {
    pool = createPool({ uri: databaseUrl!, connectionLimit: 4 });
    await pool.query(
      `INSERT INTO ai_direct_organizations
       (id, name, slug, ownerUserId)
       VALUES (?, 'Approval authorization test', 'approval-authorization-test', ?)`,
      [organizationId, users.owner],
    );
    const members = [
      [users.owner, "owner"],
      [users.admin, "admin"],
      [users.member, "member"],
      [users.requester, "member"],
      [users.oldApprover, "member"],
      [users.newApprover, "member"],
    ] as const;
    for (const [index, [userId, role]] of members.entries()) {
      const memberId = `61000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      await pool.query(
        `INSERT INTO ai_direct_organization_members
         (id, organizationId, userId, role, status, createdByUserId)
         VALUES (?, ?, ?, ?, 'active', ?)`,
        [memberId, organizationId, userId, role, users.owner],
      );
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function createPendingApproval(options: { due?: boolean } = {}) {
    sequence += 1;
    const suffix = String(sequence).padStart(12, "0");
    const offerId = `62000000-0000-4000-8000-${suffix}`;
    const approvalId = `63000000-0000-4000-8000-${suffix}`;
    await pool.query(
      `INSERT INTO ai_direct_offers
       (id, roleId, agentVersionId, companyId, status, terms, approvalId, proposedByUserId)
       VALUES (?, ?, ?, ?, 'pending_approval', '{}', ?, ?)`,
      [
        offerId,
        `64000000-0000-4000-8000-${suffix}`,
        `65000000-0000-4000-8000-${suffix}`,
        `66000000-0000-4000-8000-${suffix}`,
        approvalId,
        users.requester,
      ],
    );
    await pool.query(
      `INSERT INTO ai_direct_approvals
       (id, organizationId, targetType, targetId, requestedByUserId, approverUserId, status, expiresAt)
       VALUES (?, ?, 'offer', ?, ?, ?, 'pending', ?)`,
      [
        approvalId,
        organizationId,
        offerId,
        users.requester,
        users.oldApprover,
        options.due ? new Date(Date.now() - 60_000) : null,
      ],
    );
    return { approvalId, offerId };
  }

  async function decideAs(approvalId: string, decision: ApprovalDecision, actorUserId: string) {
    const action =
      decision === "approved" ? "approve" : decision === "rejected" ? "reject" : "cancel";
    return decideApproval(pool, {
      approvalId,
      decision,
      actorUserId,
      requestId: `mysql-${action}:${approvalId}:${actorUserId}`,
      authorize: (approval, connection) =>
        authorizeApprovalAction(connection, approval, action, actorUserId),
    });
  }

  it("enforces designated approver, organization admin, member, and cancellation authority", async () => {
    const designated = await createPendingApproval();
    await decideAs(designated.approvalId, "approved", users.oldApprover);

    const admin = await createPendingApproval();
    await decideAs(admin.approvalId, "rejected", users.admin);

    const member = await createPendingApproval();
    await expect(decideAs(member.approvalId, "approved", users.member)).rejects.toMatchObject({
      code: "FORBIDDEN_SCOPE",
    });

    const requester = await createPendingApproval();
    await decideAs(requester.approvalId, "cancelled", users.requester);

    const unrelatedOwner = await createPendingApproval();
    await expect(
      decideAs(unrelatedOwner.approvalId, "cancelled", users.owner),
    ).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });

    const [rows] = await pool.query<any[]>(
      "SELECT id, status FROM ai_direct_approvals WHERE id IN (?, ?, ?, ?, ?)",
      [
        designated.approvalId,
        admin.approvalId,
        member.approvalId,
        requester.approvalId,
        unrelatedOwner.approvalId,
      ],
    );
    const statuses = Object.fromEntries(rows.map((row) => [row.id, row.status]));
    expect(statuses).toMatchObject({
      [designated.approvalId]: "approved",
      [admin.approvalId]: "rejected",
      [member.approvalId]: "pending",
      [requester.approvalId]: "cancelled",
      [unrelatedOwner.approvalId]: "pending",
    });
  });

  it("makes the old approver lose authority immediately after delegation", async () => {
    const fixture = await createPendingApproval();
    await delegateApproval(pool, {
      approvalId: fixture.approvalId,
      actorUserId: users.admin,
      toUserId: users.newApprover,
      requestId: `mysql-delegate:${fixture.approvalId}`,
      reason: "handoff",
    });

    await expect(decideAs(fixture.approvalId, "approved", users.oldApprover)).rejects.toMatchObject(
      { code: "FORBIDDEN_SCOPE" },
    );
    await decideAs(fixture.approvalId, "approved", users.newApprover);

    const [[approval]] = await pool.query<any[]>(
      "SELECT status, approverUserId FROM ai_direct_approvals WHERE id = ?",
      [fixture.approvalId],
    );
    const [events] = await pool.query<any[]>(
      `SELECT eventType, sequence
       FROM ai_direct_approval_events
       WHERE approvalId = ?
       ORDER BY sequence`,
      [fixture.approvalId],
    );
    expect(approval).toMatchObject({ status: "approved", approverUserId: users.newApprover });
    expect(events).toEqual([
      { eventType: "approval.delegated", sequence: 1 },
      { eventType: "approval.approved", sequence: 2 },
    ]);
  });

  it("serializes delegation against a terminal decision without stale authority", async () => {
    const fixture = await createPendingApproval();
    const results = await Promise.allSettled([
      delegateApproval(pool, {
        approvalId: fixture.approvalId,
        actorUserId: users.admin,
        toUserId: users.newApprover,
        requestId: `mysql-race-delegate:${fixture.approvalId}`,
      }),
      decideAs(fixture.approvalId, "approved", users.oldApprover),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);

    const [[approval]] = await pool.query<any[]>(
      "SELECT status, approverUserId FROM ai_direct_approvals WHERE id = ?",
      [fixture.approvalId],
    );
    const [[counts]] = await pool.query<any[]>(
      `SELECT
         (SELECT COUNT(*) FROM ai_direct_approval_delegations WHERE approvalId = ?) AS delegationCount,
         (SELECT COUNT(*) FROM ai_direct_approval_events WHERE approvalId = ?) AS eventCount`,
      [fixture.approvalId, fixture.approvalId],
    );
    if (approval.status === "approved") {
      expect(approval.approverUserId).toBe(users.oldApprover);
      expect(counts).toMatchObject({ delegationCount: 0, eventCount: 1 });
    } else {
      expect(approval).toMatchObject({ status: "pending", approverUserId: users.newApprover });
      expect(counts).toMatchObject({ delegationCount: 1, eventCount: 1 });
    }
  });

  it("allows timeout to use the latest delegated state", async () => {
    const fixture = await createPendingApproval({ due: true });
    await delegateApproval(pool, {
      approvalId: fixture.approvalId,
      actorUserId: users.owner,
      toUserId: users.newApprover,
      requestId: `mysql-timeout-delegate:${fixture.approvalId}`,
    });
    await decideApproval(pool, {
      approvalId: fixture.approvalId,
      decision: "expired",
      actorUserId: null,
      requestId: `approval-timeout:${fixture.approvalId}`,
      reason: "deadline_reached",
    });

    const [[approval]] = await pool.query<any[]>(
      "SELECT status, approverUserId FROM ai_direct_approvals WHERE id = ?",
      [fixture.approvalId],
    );
    expect(approval).toMatchObject({ status: "expired", approverUserId: users.newApprover });
  });
});
