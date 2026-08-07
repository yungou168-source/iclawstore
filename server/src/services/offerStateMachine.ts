/**
 * Offer State Machine — AI Direct Hiring P2.
 *
 * States:
 *   draft → pending_approval → sent → accepted | rejected | expired | revoked
 *                                                           ↓
 *                                                     employment (implicit)
 *
 * Valid transitions are enforced via `allowedFrom`. Any illegal transition
 * throws INVALID_STATE_TRANSITION.
 */

import { AiDirectHiringError, ErrorCodes } from './aiDirectErrors.js';

export const OFFER_STATUSES = [
  'draft',
  'pending_approval',
  'sent',
  'accepted',
  'rejected',
  'expired',
  'revoked',
] as const;

export type OfferStatus = (typeof OFFER_STATUSES)[number];

export interface TransitionResult {
  from: OfferStatus;
  to: OfferStatus;
  event: string;
}

const allowedFrom: Record<OfferStatus, Set<OfferStatus>> = {
  draft: new Set(['pending_approval']),
  pending_approval: new Set(['sent', 'rejected', 'expired', 'revoked']),
  sent: new Set(['accepted', 'rejected', 'expired', 'revoked']),
  accepted: new Set([]),
  rejected: new Set([]),
  expired: new Set([]),
  revoked: new Set([]),
};

export function isValidOfferTransition(from: OfferStatus, to: OfferStatus): boolean {
  return allowedFrom[from]?.has(to) ?? false;
}

export function transitionOffer(
  from: OfferStatus,
  to: OfferStatus,
  event: string,
): TransitionResult {
  if (!isValidOfferTransition(from, to)) {
    throw new AiDirectHiringError(
      ErrorCodes.INVALID_TRANSITION,
      `Offer 状态机不允许从 '${from}' 到 '${to}' 的转移 (event: ${event})`,
      409,
      { from, to, event },
    );
  }
  return { from, to, event };
}

export function getOfferTerminalStatuses(): OfferStatus[] {
  return ['accepted', 'rejected', 'expired', 'revoked'];
}

export function isOfferTerminal(status: OfferStatus): boolean {
  return getOfferTerminalStatuses().includes(status);
}
