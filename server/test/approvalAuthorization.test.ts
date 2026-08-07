import { describe, expect, it, vi } from 'bun:test';
import { ErrorCodes } from '../src/services/aiDirectErrors.js';
import {
  authorizeApprovalAction,
  requireActiveDelegationTarget,
} from '../src/services/approvalAuthorization.js';
import type { ApprovalRow } from '../src/services/approvalRecord.js';

const approval: ApprovalRow = {
  id: 'approval-1',
  organizationId: 'org-1',
  targetType: 'offer',
  targetId: 'offer-1',
  requestedByUserId: 'requester-1',
  approverUserId: 'approver-1',
  status: 'pending',
  expiresAt: null,
  isDue: false,
};

function connectionWithMember(role: string | null, status = 'active') {
  return {
    query: vi.fn(async () => [role ? [{ role, status }] : [], []]),
  };
}

describe('approval authorization policy', () => {
  it('allows the current approver without an organization lookup', async () => {
    const connection = connectionWithMember(null);
    await authorizeApprovalAction(connection as any, approval, 'approve', 'approver-1');
    expect(connection.query).not.toHaveBeenCalled();
  });

  for (const role of ['owner', 'admin']) {
    it(`allows an organization ${role} to decide`, async () => {
      const connection = connectionWithMember(role);
      await authorizeApprovalAction(connection as any, approval, 'reject', `${role}-1`);
      expect(connection.query).toHaveBeenCalledTimes(1);
    });
  }

  it('rejects an ordinary member decision', async () => {
    const connection = connectionWithMember('member');
    await expect(
      authorizeApprovalAction(connection as any, approval, 'approve', 'member-1'),
    ).rejects.toMatchObject({ code: ErrorCodes.FORBIDDEN_SCOPE });
  });

  it('requires the exact approver for a platform approval', async () => {
    const connection = connectionWithMember('owner');
    await expect(
      authorizeApprovalAction(
        connection as any,
        { ...approval, organizationId: null },
        'approve',
        'other-1',
      ),
    ).rejects.toMatchObject({ code: ErrorCodes.FORBIDDEN_SCOPE });
  });

  it('allows cancellation only for the requester or current approver', async () => {
    const connection = connectionWithMember('owner');
    await authorizeApprovalAction(connection as any, approval, 'cancel', 'requester-1');
    await authorizeApprovalAction(connection as any, approval, 'cancel', 'approver-1');
    await expect(
      authorizeApprovalAction(connection as any, approval, 'cancel', 'owner-1'),
    ).rejects.toMatchObject({ code: ErrorCodes.FORBIDDEN_SCOPE });
    expect(connection.query).not.toHaveBeenCalled();
  });

  it('requires an organization admin to delegate even when the actor is the approver', async () => {
    const connection = connectionWithMember('member');
    await expect(
      authorizeApprovalAction(connection as any, approval, 'delegate', 'approver-1'),
    ).rejects.toMatchObject({ code: ErrorCodes.FORBIDDEN_SCOPE });
  });

  it('locks and accepts only an active delegation target', async () => {
    const active = connectionWithMember('member');
    await requireActiveDelegationTarget(active as any, 'org-1', 'target-1');
    expect(active.query.mock.calls[0]?.[0]).toContain('FOR SHARE');

    const inactive = connectionWithMember('member', 'inactive');
    await expect(
      requireActiveDelegationTarget(inactive as any, 'org-1', 'target-1'),
    ).rejects.toMatchObject({ code: ErrorCodes.FORBIDDEN_SCOPE });
  });
});