/**
 * Employment State Machine — AI Direct Hiring P2.
 *
 * States:
 *   candidate → evaluating → offer_pending → offered → accepted → onboarding → active → paused → offboarding → terminated
 *                                                     ↑___________transferring___________↓
 *
 * Valid transitions are enforced via `allowedFrom`. Any illegal transition
 * throws INVALID_STATE_TRANSITION.
 */

import { AiDirectHiringError, ErrorCodes } from "./aiDirectErrors.js";

export const EMPLOYMENT_STATUSES = [
  "candidate",
  "evaluating",
  "offer_pending",
  "offered",
  "accepted",
  "onboarding",
  "active",
  "paused",
  "offboarding",
  "terminated",
] as const;

export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export interface TransitionResult {
  from: EmploymentStatus;
  to: EmploymentStatus;
  event: string;
}

const allowedFrom: Record<EmploymentStatus, Set<EmploymentStatus>> = {
  candidate: new Set(["evaluating", "offer_pending", "terminated"]),
  evaluating: new Set(["offer_pending", "terminated"]),
  offer_pending: new Set(["offered", "evaluating", "terminated"]),
  offered: new Set(["accepted", "evaluating", "terminated"]),
  accepted: new Set(["onboarding", "offboarding", "terminated"]),
  onboarding: new Set(["active", "offboarding", "terminated"]),
  active: new Set(["paused", "offboarding", "terminated"]),
  paused: new Set(["active", "offboarding", "terminated"]),
  offboarding: new Set(["terminated", "active", "paused"]),
  terminated: new Set([]),
};

export function isValidEmploymentTransition(from: EmploymentStatus, to: EmploymentStatus): boolean {
  return allowedFrom[from]?.has(to) ?? false;
}

export function transitionEmployment(
  from: EmploymentStatus,
  to: EmploymentStatus,
  event: string,
): TransitionResult {
  if (!isValidEmploymentTransition(from, to)) {
    throw new AiDirectHiringError(
      ErrorCodes.INVALID_TRANSITION,
      `Employment 状态机不允许从 '${from}' 到 '${to}' 的转移 (event: ${event})`,
      409,
      { from, to, event },
    );
  }
  return { from, to, event };
}

export function getEmploymentTerminalStatuses(): EmploymentStatus[] {
  return ["terminated"];
}

export function isEmploymentTerminal(status: EmploymentStatus): boolean {
  return getEmploymentTerminalStatuses().includes(status);
}
