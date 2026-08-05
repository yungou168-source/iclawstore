import { AiDirectHiringError, ErrorCodes } from './aiDirectErrors.js';

export const DEPARTMENT_STATUSES = ['active', 'inactive', 'archived'] as const;
export type DepartmentStatus = (typeof DEPARTMENT_STATUSES)[number];

export const POSITION_STATUSES = ['draft', 'open', 'paused', 'closed', 'archived'] as const;
export type PositionStatus = (typeof POSITION_STATUSES)[number];

const departmentTransitions: Record<DepartmentStatus, ReadonlySet<DepartmentStatus>> = {
  active: new Set(['inactive', 'archived']),
  inactive: new Set(['active', 'archived']),
  archived: new Set(),
};

const positionTransitions: Record<PositionStatus, ReadonlySet<PositionStatus>> = {
  draft: new Set(['open', 'archived']),
  open: new Set(['paused', 'closed', 'archived']),
  paused: new Set(['open', 'closed', 'archived']),
  closed: new Set(['archived']),
  archived: new Set(),
};

export const isDepartmentTransitionAllowed = (
  from: DepartmentStatus,
  to: DepartmentStatus,
): boolean => departmentTransitions[from]?.has(to) ?? false;

export const isPositionTransitionAllowed = (
  from: PositionStatus,
  to: PositionStatus,
): boolean => positionTransitions[from]?.has(to) ?? false;

export function transitionDepartment(from: DepartmentStatus, to: DepartmentStatus): void {
  if (!isDepartmentTransitionAllowed(from, to)) {
    throw new AiDirectHiringError(
      ErrorCodes.INVALID_TRANSITION,
      `Department 状态不能从 '${from}' 变更为 '${to}'`,
      409,
      { from, to },
    );
  }
}

export function transitionPosition(from: PositionStatus, to: PositionStatus): void {
  if (!isPositionTransitionAllowed(from, to)) {
    throw new AiDirectHiringError(
      ErrorCodes.INVALID_TRANSITION,
      `Position 状态不能从 '${from}' 变更为 '${to}'`,
      409,
      { from, to },
    );
  }
}

export const isPositionOpen = (status: string): boolean => status === 'open';

export const countsTowardHeadcount = (status: string): boolean =>
  ['accepted', 'onboarding', 'active', 'paused', 'offboarding'].includes(status);