import { describe, expect, it } from 'bun:test';
import { AiDirectHiringError } from '../src/services/aiDirectErrors.js';
import {
  countsTowardHeadcount,
  isDepartmentTransitionAllowed,
  isPositionOpen,
  isPositionTransitionAllowed,
  transitionDepartment,
  transitionPosition,
} from '../src/services/workforceStateMachine.js';

describe('workforceStateMachine', () => {
  it('keeps archived departments terminal', () => {
    expect(isDepartmentTransitionAllowed('active', 'inactive')).toBe(true);
    expect(isDepartmentTransitionAllowed('archived', 'active')).toBe(false);
    expect(() => transitionDepartment('archived', 'active')).toThrow(AiDirectHiringError);
  });

  it('allows only explicit Position lifecycle transitions', () => {
    expect(isPositionTransitionAllowed('draft', 'open')).toBe(true);
    expect(isPositionTransitionAllowed('draft', 'closed')).toBe(false);
    expect(isPositionTransitionAllowed('open', 'paused')).toBe(true);
    expect(isPositionTransitionAllowed('closed', 'open')).toBe(false);
    expect(() => transitionPosition('closed', 'open')).toThrow(AiDirectHiringError);
  });

  it('counts only Employment states that occupy a Position', () => {
    expect(isPositionOpen('open')).toBe(true);
    expect(isPositionOpen('paused')).toBe(false);
    expect(countsTowardHeadcount('accepted')).toBe(true);
    expect(countsTowardHeadcount('onboarding')).toBe(true);
    expect(countsTowardHeadcount('active')).toBe(true);
    expect(countsTowardHeadcount('paused')).toBe(true);
    expect(countsTowardHeadcount('offboarding')).toBe(true);
    expect(countsTowardHeadcount('candidate')).toBe(false);
    expect(countsTowardHeadcount('terminated')).toBe(false);
  });
});