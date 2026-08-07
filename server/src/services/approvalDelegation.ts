import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { publishOutboxEvent } from '../utils/outbox.js';
import { AiDirectHiringError, ErrorCodes } from './aiDirectErrors.js';
import {
  authorizeApprovalAction,
  requireActiveDelegationTarget,
} from './approvalAuthorization.js';
import { appendApprovalEvent } from './approvalEvents.js';
import { lockApproval } from './approvalRecord.js';

export type DelegateApprovalInput = {
  approvalId: string;
  actorUserId: string;
  toUserId: string;
  requestId: string;
  reason?: string | null;
};

export type ApprovalDelegationResult = {
  id: string;
  approvalId: string;
  fromUserId: string | null;
  toUserId: string;
};

async function delegateApprovalInTransaction(
  connection: PoolConnection,
  input: DelegateApprovalInput,
): Promise<ApprovalDelegationResult> {
  const approval = await lockApproval(connection, input.approvalId);
  if (approval.status !== 'pending' || !approval.organizationId) {
    throw new AiDirectHiringError(
      ErrorCodes.INVALID_TRANSITION,
      '只有组织范围内的 pending Approval 可以委派',
      409,
    );
  }

  await authorizeApprovalAction(connection, approval, 'delegate', input.actorUserId);
  await requireActiveDelegationTarget(connection, approval.organizationId, input.toUserId);

  const delegationId = randomUUID();
  await connection.query(
    `INSERT INTO ai_direct_approval_delegations
     (id, approvalId, organizationId, fromUserId, toUserId, delegatedByUserId, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      delegationId,
      approval.id,
      approval.organizationId,
      approval.approverUserId,
      input.toUserId,
      input.actorUserId,
      input.reason ?? null,
    ],
  );

  const [update] = await connection.query<ResultSetHeader>(
    `UPDATE ai_direct_approvals
     SET approverUserId = ?, updatedAt = NOW(3)
     WHERE id = ? AND status = 'pending' AND approverUserId <=> ?`,
    [input.toUserId, approval.id, approval.approverUserId],
  );
  if (update.affectedRows !== 1) {
    throw new AiDirectHiringError(
      ErrorCodes.INVALID_TRANSITION,
      'Approval 已被其他操作更新',
      409,
    );
  }

  const metadata = {
    delegationId,
    fromUserId: approval.approverUserId,
    toUserId: input.toUserId,
    reason: input.reason ?? null,
  };
  await appendApprovalEvent(connection, {
    approvalId: approval.id,
    organizationId: approval.organizationId,
    eventType: 'approval.delegated',
    actorUserId: input.actorUserId,
    requestId: input.requestId,
    metadata,
  });
  await connection.query(
    `INSERT INTO ai_direct_audit_events
     (id, organizationId, actorUserId, action, targetType, targetId, requestId, outcome, metadata)
     VALUES (?, ?, ?, 'approval.delegated', 'approval', ?, ?, 'success', ?)`,
    [
      randomUUID(),
      approval.organizationId,
      input.actorUserId,
      approval.id,
      input.requestId,
      JSON.stringify(metadata),
    ],
  );
  await publishOutboxEvent(connection, {
    organizationId: approval.organizationId,
    aggregateType: 'approval',
    aggregateId: approval.id,
    eventType: 'approval.delegated.v1',
    payload: {
      approvalId: approval.id,
      ...metadata,
      delegatedByUserId: input.actorUserId,
    },
  });

  return {
    id: delegationId,
    approvalId: approval.id,
    fromUserId: approval.approverUserId,
    toUserId: input.toUserId,
  };
}

export async function delegateApproval(
  pool: Pick<Pool, 'getConnection'>,
  input: DelegateApprovalInput,
): Promise<ApprovalDelegationResult> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await delegateApprovalInTransaction(connection, input);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}