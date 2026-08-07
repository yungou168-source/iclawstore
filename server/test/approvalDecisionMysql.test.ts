import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createPool, type Pool } from 'mysql2/promise';
import { decideApproval } from '../src/services/approvalDecision.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('approval decision MySQL transaction', () => {
  let pool: Pool;
  let sequence = 0;

  beforeAll(() => {
    pool = createPool({ uri: databaseUrl!, connectionLimit: 4 });
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function createPendingOfferApproval(options: {
    due?: boolean;
    offerStatus?: string;
    linkedApprovalId?: string | null;
  } = {}) {
    sequence += 1;
    const suffix = String(sequence).padStart(12, '0');
    const offerId = `10000000-0000-4000-8000-${suffix}`;
    const approvalId = `20000000-0000-4000-8000-${suffix}`;
    await pool.query(
      `INSERT INTO ai_direct_offers
       (id, roleId, agentVersionId, companyId, status, terms, approvalId, proposedByUserId)
       VALUES (?, ?, ?, ?, ?, '{}', ?, 'mysql-requester')`,
      [
        offerId,
        `30000000-0000-4000-8000-${suffix}`,
        `40000000-0000-4000-8000-${suffix}`,
        `50000000-0000-4000-8000-${suffix}`,
        options.offerStatus ?? 'pending_approval',
        options.linkedApprovalId === undefined ? approvalId : options.linkedApprovalId,
      ],
    );
    await pool.query(
      `INSERT INTO ai_direct_approvals
       (id, organizationId, targetType, targetId, requestedByUserId, status, expiresAt)
       VALUES (?, NULL, 'offer', ?, 'mysql-requester', 'pending', ?)`,
      [approvalId, offerId, options.due ? new Date(Date.now() - 60_000) : null],
    );
    return { approvalId, offerId };
  }

  it('commits rejection to both approval and linked offer with governance records', async () => {
    const fixture = await createPendingOfferApproval();

    await decideApproval(pool, {
      approvalId: fixture.approvalId,
      decision: 'rejected',
      actorUserId: 'mysql-approver',
      requestId: `mysql-reject:${fixture.approvalId}`,
      reason: 'integration rejection',
    });

    const [[approval]] = await pool.query<any[]>(
      'SELECT status, decision, decisionReason FROM ai_direct_approvals WHERE id = ?',
      [fixture.approvalId],
    );
    const [[offer]] = await pool.query<any[]>(
      'SELECT status, rejectedAt, rejectedReason FROM ai_direct_offers WHERE id = ?',
      [fixture.offerId],
    );
    const [[counts]] = await pool.query<any[]>(
      `SELECT
         (SELECT COUNT(*) FROM ai_direct_approval_events WHERE approvalId = ?) AS eventCount,
         (SELECT COUNT(*) FROM ai_direct_audit_events WHERE targetType = 'approval' AND targetId = ?) AS auditCount,
         (SELECT COUNT(*) FROM ai_direct_outbox_events WHERE aggregateType = 'approval' AND aggregateId = ?) AS outboxCount`,
      [fixture.approvalId, fixture.approvalId, fixture.approvalId],
    );

    expect(approval).toMatchObject({
      status: 'rejected',
      decision: 'rejected',
      decisionReason: 'integration rejection',
    });
    expect(offer.status).toBe('rejected');
    expect(offer.rejectedAt).not.toBeNull();
    expect(offer.rejectedReason).toBe('integration rejection');
    expect(counts).toMatchObject({ eventCount: 1, auditCount: 1, outboxCount: 1 });
  });

  it('commits cancellation to the approval and revokes the linked offer', async () => {
    const fixture = await createPendingOfferApproval();

    await decideApproval(pool, {
      approvalId: fixture.approvalId,
      decision: 'cancelled',
      actorUserId: 'mysql-requester',
      requestId: `mysql-cancel:${fixture.approvalId}`,
    });

    const [[approval]] = await pool.query<any[]>(
      'SELECT status, decision FROM ai_direct_approvals WHERE id = ?',
      [fixture.approvalId],
    );
    const [[offer]] = await pool.query<any[]>(
      'SELECT status FROM ai_direct_offers WHERE id = ?',
      [fixture.offerId],
    );
    expect(approval).toMatchObject({ status: 'cancelled', decision: 'cancelled' });
    expect(offer.status).toBe('revoked');
  });

  it('commits timeout expiry to both approval and linked offer', async () => {
    const fixture = await createPendingOfferApproval({ due: true });

    await decideApproval(pool, {
      approvalId: fixture.approvalId,
      decision: 'expired',
      actorUserId: null,
      requestId: `approval-timeout:${fixture.approvalId}`,
      reason: 'deadline_reached',
    });

    const [[approval]] = await pool.query<any[]>(
      'SELECT status, decision FROM ai_direct_approvals WHERE id = ?',
      [fixture.approvalId],
    );
    const [[offer]] = await pool.query<any[]>(
      'SELECT status FROM ai_direct_offers WHERE id = ?',
      [fixture.offerId],
    );
    expect(approval).toMatchObject({ status: 'expired', decision: 'expired' });
    expect(offer.status).toBe('expired');
  });

  it('rolls back cancellation and governance writes when the offer link is invalid', async () => {
    const fixture = await createPendingOfferApproval({ linkedApprovalId: null });

    await expect(decideApproval(pool, {
      approvalId: fixture.approvalId,
      decision: 'cancelled',
      actorUserId: 'mysql-requester',
      requestId: `mysql-cancel-rollback:${fixture.approvalId}`,
    })).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });

    const [[approval]] = await pool.query<any[]>(
      'SELECT status, decision, decidedAt FROM ai_direct_approvals WHERE id = ?',
      [fixture.approvalId],
    );
    const [[counts]] = await pool.query<any[]>(
      `SELECT
         (SELECT COUNT(*) FROM ai_direct_approval_events WHERE approvalId = ?) AS eventCount,
         (SELECT COUNT(*) FROM ai_direct_audit_events WHERE targetType = 'approval' AND targetId = ?) AS auditCount,
         (SELECT COUNT(*) FROM ai_direct_outbox_events WHERE aggregateType = 'approval' AND aggregateId = ?) AS outboxCount`,
      [fixture.approvalId, fixture.approvalId, fixture.approvalId],
    );
    expect(approval).toMatchObject({ status: 'pending', decision: null, decidedAt: null });
    expect(counts).toMatchObject({ eventCount: 0, auditCount: 0, outboxCount: 0 });
  });

  it('reuses the transaction connection for locked-state authorization', async () => {
    const singleConnectionPool = createPool({ uri: databaseUrl!, connectionLimit: 1 });
    const fixture = await createPendingOfferApproval();
    try {
      await decideApproval(singleConnectionPool, {
        approvalId: fixture.approvalId,
        decision: 'approved',
        actorUserId: 'mysql-approver',
        requestId: `mysql-authorize:${fixture.approvalId}`,
        authorize: async (approval, connection) => {
          const [[row]] = await connection.query<any[]>(
            'SELECT status FROM ai_direct_approvals WHERE id = ?',
            [approval.id],
          );
          expect(row.status).toBe('pending');
        },
      });
    } finally {
      await singleConnectionPool.end();
    }

    const [[offer]] = await pool.query<any[]>(
      'SELECT status FROM ai_direct_offers WHERE id = ?',
      [fixture.offerId],
    );
    expect(offer.status).toBe('sent');
  });

  it('allows only one winner among cancellation, manual approval, and timeout expiry', async () => {
    const fixture = await createPendingOfferApproval({ due: true });

    const results = await Promise.allSettled([
      decideApproval(pool, {
        approvalId: fixture.approvalId,
        decision: 'cancelled',
        actorUserId: 'mysql-requester',
        requestId: `mysql-cancel:${fixture.approvalId}`,
      }),
      decideApproval(pool, {
        approvalId: fixture.approvalId,
        decision: 'approved',
        actorUserId: 'mysql-approver',
        requestId: `mysql-approve:${fixture.approvalId}`,
      }),
      decideApproval(pool, {
        approvalId: fixture.approvalId,
        decision: 'expired',
        actorUserId: null,
        requestId: `approval-timeout:${fixture.approvalId}`,
        reason: 'deadline_reached',
      }),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(2);
    const [[approval]] = await pool.query<any[]>(
      'SELECT status FROM ai_direct_approvals WHERE id = ?',
      [fixture.approvalId],
    );
    const [[offer]] = await pool.query<any[]>(
      'SELECT status FROM ai_direct_offers WHERE id = ?',
      [fixture.offerId],
    );
    const [[eventCount]] = await pool.query<any[]>(
      'SELECT COUNT(*) AS count FROM ai_direct_approval_events WHERE approvalId = ?',
      [fixture.approvalId],
    );
    expect(['cancelled', 'approved', 'expired']).toContain(approval.status);
    const offerStatusByDecision: Record<string, string> = {
      cancelled: 'revoked',
      approved: 'sent',
      expired: 'expired',
    };
    expect(offer.status).toBe(offerStatusByDecision[approval.status]);
    expect(eventCount.count).toBe(1);
  });
});
