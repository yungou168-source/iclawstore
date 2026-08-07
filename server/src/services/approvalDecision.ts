import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { publishOutboxEvent } from '../utils/outbox.js';
import { AiDirectHiringError, ErrorCodes } from './aiDirectErrors.js';
import { appendApprovalEvent } from './approvalEvents.js';
import { lockApproval, type ApprovalRow } from './approvalRecord.js';
import {
  transitionApproval,
  type ApprovalStatus,
} from './approvalStateMachine.js';
import { transitionOffer, type OfferStatus } from './offerStateMachine.js';

export type ApprovalDecision = Extract<
  ApprovalStatus,
  'approved' | 'rejected' | 'expired' | 'cancelled'
>;

type DecisionSpec = {
  event: 'approve' | 'reject' | 'expire' | 'cancel';
  eventType: 'approved' | 'rejected' | 'expired' | 'cancelled';
  offerStatus: Extract<OfferStatus, 'sent' | 'rejected' | 'expired' | 'revoked'>;
};

const decisionSpecs: Record<ApprovalDecision, DecisionSpec> = {
  approved: { event: 'approve', eventType: 'approved', offerStatus: 'sent' },
  rejected: { event: 'reject', eventType: 'rejected', offerStatus: 'rejected' },
  expired: { event: 'expire', eventType: 'expired', offerStatus: 'expired' },
  cancelled: { event: 'cancel', eventType: 'cancelled', offerStatus: 'revoked' },
};

export type DecideApprovalInput = {
  approvalId: string;
  decision: ApprovalDecision;
  actorUserId: string | null;
  requestId: string;
  reason?: string | null;
  authorize?: (approval: ApprovalRow, connection: PoolConnection) => Promise<void>;
};

async function updateLinkedOffer(
  connection: PoolConnection,
  approval: ApprovalRow,
  decision: ApprovalDecision,
  reason: string | null,
): Promise<void> {
  if (approval.targetType !== 'offer' || !approval.targetId) return;

  const targetStatus = decisionSpecs[decision].offerStatus;
  transitionOffer('pending_approval', targetStatus, `approval.${decisionSpecs[decision].event}`);

  const fields = ['status = ?', 'updatedAt = NOW(3)'];
  const values: unknown[] = [targetStatus];
  if (targetStatus === 'rejected') {
    fields.push('rejectedAt = NOW(3)', 'rejectedReason = ?');
    values.push(reason ?? 'Approval rejected');
  }

  const [result] = await connection.query<ResultSetHeader>(
    `UPDATE ai_direct_offers
     SET ${fields.join(', ')}
     WHERE id = ? AND approvalId = ? AND status = 'pending_approval'`,
    [...values, approval.targetId, approval.id],
  );
  if (result.affectedRows !== 1) {
    throw new AiDirectHiringError(
      ErrorCodes.INVALID_TRANSITION,
      '关联 Offer 不存在、审批关系不匹配或已不处于 pending_approval 状态',
      409,
      { approvalId: approval.id, offerId: approval.targetId, targetStatus },
    );
  }
}

async function writeDecisionAudit(
  connection: PoolConnection,
  approval: ApprovalRow,
  input: DecideApprovalInput,
  event: DecisionSpec['event'],
): Promise<void> {
  await connection.query(
    `INSERT INTO ai_direct_audit_events
     (id, organizationId, actorUserId, action, targetType, targetId, requestId, outcome, metadata)
     VALUES (?, ?, ?, ?, 'approval', ?, ?, 'success', ?)`,
    [
      randomUUID(),
      approval.organizationId,
      input.actorUserId,
      `approval.${event}`,
      approval.id,
      input.requestId,
      JSON.stringify({
        from: 'pending',
        to: input.decision,
        targetType: approval.targetType,
        targetId: approval.targetId,
        reason: input.reason ?? null,
      }),
    ],
  );
}

async function decideApprovalInTransaction(
  connection: PoolConnection,
  input: DecideApprovalInput,
): Promise<ApprovalRow> {
  const approval = await lockApproval(connection, input.approvalId);
  const spec = decisionSpecs[input.decision];

  if (approval.status !== 'pending') {
    throw new AiDirectHiringError(
      ErrorCodes.INVALID_TRANSITION,
      `只有 pending 状态的 Approval 可以裁决，当前: '${approval.status}'`,
      409,
      { approvalId: approval.id, status: approval.status, decision: input.decision },
    );
  }
  if (input.decision === 'expired' && !approval.isDue) {
    throw new AiDirectHiringError(
      ErrorCodes.INVALID_TRANSITION,
      'Approval 尚未到期',
      409,
      { approvalId: approval.id, expiresAt: approval.expiresAt },
    );
  }

  await input.authorize?.(approval, connection);
  const transition = transitionApproval(approval.status, input.decision, spec.event);
  const approverAssignment = input.actorUserId && !approval.approverUserId
    ? ', approverUserId = ?'
    : '';
  const params: unknown[] = [input.decision, input.decision, input.reason ?? null];
  if (approverAssignment) params.push(input.actorUserId);
  params.push(approval.id, transition.from);

  const [approvalUpdate] = await connection.query<ResultSetHeader>(
    `UPDATE ai_direct_approvals
     SET status = ?, decision = ?, decisionReason = ?, decidedAt = NOW(3), updatedAt = NOW(3)${approverAssignment}
     WHERE id = ? AND status = ?`,
    params,
  );
  if (approvalUpdate.affectedRows !== 1) {
    throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, 'Approval 已被其他操作更新', 409);
  }

  await updateLinkedOffer(connection, approval, input.decision, input.reason ?? null);

  const eventMetadata = {
    from: transition.from,
    to: transition.to,
    targetType: approval.targetType,
    targetId: approval.targetId,
    reason: input.reason ?? null,
  };
  await appendApprovalEvent(connection, {
    approvalId: approval.id,
    organizationId: approval.organizationId,
    eventType: `approval.${spec.eventType}`,
    actorUserId: input.actorUserId,
    requestId: input.requestId,
    metadata: eventMetadata,
  });
  await writeDecisionAudit(connection, approval, input, spec.event);
  await publishOutboxEvent(connection, {
    organizationId: approval.organizationId,
    aggregateType: 'approval',
    aggregateId: approval.id,
    eventType: `approval.${spec.eventType}.v1`,
    payload: {
      approvalId: approval.id,
      targetType: approval.targetType,
      targetId: approval.targetId,
      from: transition.from,
      to: transition.to,
      actorUserId: input.actorUserId,
      reason: input.reason ?? null,
      linkedOfferStatus: approval.targetType === 'offer' ? spec.offerStatus : null,
    },
  });

  const [updatedRows] = await connection.query(
    'SELECT * FROM ai_direct_approvals WHERE id = ? LIMIT 1',
    [approval.id],
  );
  return (updatedRows as ApprovalRow[])[0];
}

export async function decideApproval(
  pool: Pick<Pool, 'getConnection'>,
  input: DecideApprovalInput,
): Promise<ApprovalRow> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const approval = await decideApprovalInTransaction(connection, input);
    await connection.commit();
    return approval;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}