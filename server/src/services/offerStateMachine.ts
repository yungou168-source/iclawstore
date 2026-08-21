import { AiDirectHiringError, ErrorCodes } from "./aiDirectErrors.js";

export const OFFER_STATUSES = ["issued"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export interface TransitionResult {
  from: OfferStatus;
  to: OfferStatus;
  event: string;
}

export function isValidOfferTransition(_from: OfferStatus, _to: OfferStatus): boolean {
  return false;
}

export function transitionOffer(
  from: OfferStatus,
  to: OfferStatus,
  event: string,
): TransitionResult {
  throw new AiDirectHiringError(
    ErrorCodes.INVALID_TRANSITION,
    `Offer 是不可变的支付雇佣凭证，不允许状态转移 (from: ${from}, to: ${to}, event: ${event})`,
    409,
    { from, to, event },
  );
}

export function getOfferTerminalStatuses(): OfferStatus[] {
  return ["issued"];
}

export function isOfferTerminal(status: OfferStatus): boolean {
  return status === "issued";
}
