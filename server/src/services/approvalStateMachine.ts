/**
 * Approval State Machine — AI Direct Hiring P2.
 *
 * States:
 *   pending → approved | rejected | expired | cancelled
 *
 * Valid transitions are enforced via `allowedFrom`. Any illegal transition
 * throws INVALID_STATE_TRANSITION.
 */

import { AiDirectHiringError, ErrorCodes } from "./aiDirectErrors.js";

export const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "cancelled",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export interface TransitionResult {
  from: ApprovalStatus;
  to: ApprovalStatus;
  event: string;
}

const allowedFrom: Record<ApprovalStatus, Set<ApprovalStatus>> = {
  pending: new Set(["approved", "rejected", "expired", "cancelled"]),
  approved: new Set([]),
  rejected: new Set([]),
  expired: new Set([]),
  cancelled: new Set([]),
};

export function isValidApprovalTransition(from: ApprovalStatus, to: ApprovalStatus): boolean {
  return allowedFrom[from]?.has(to) ?? false;
}

export function transitionApproval(
  from: ApprovalStatus,
  to: ApprovalStatus,
  event: string,
): TransitionResult {
  if (!isValidApprovalTransition(from, to)) {
    throw new AiDirectHiringError(
      ErrorCodes.INVALID_TRANSITION,
      `Approval 状态机不允许从 '${from}' 到 '${to}' 的转移 (event: ${event})`,
      409,
      { from, to, event },
    );
  }
  return { from, to, event };
}

export function isApprovalTerminal(status: ApprovalStatus): boolean {
  return ["approved", "rejected", "expired", "cancelled"].includes(status);
}
