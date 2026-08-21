import { describe, expect, it } from 'bun:test';
import { decideCandidateReadiness } from './candidateReadinessGate.js';

const ready = {
  domain: 'profiles',
  candidateReady: true,
  unresolvedDifferences: 0,
  unclassifiedDifferences: 0,
  pendingAssets: 0,
  failedAssets: 0,
  checkpointComplete: true,
};

describe('candidate readiness gate', () => {
  it('allows only a complete candidate report', () => {
    expect(decideCandidateReadiness('candidate', ready)).toEqual({
      allowed: true,
      environment: 'candidate',
      readMode: 'candidate_only',
      rollbackReadMode: 'convex_authoritative',
      reason: null,
    });
  });

  it('rejects production regardless of report readiness', () => {
    const decision = decideCandidateReadiness('production', ready);
    expect(decision.allowed).toBe(false);
    expect(decision.rollbackReadMode).toBe('convex_authoritative');
  });

  it('rejects unresolved, asset, or checkpoint backlog', () => {
    const decision = decideCandidateReadiness('candidate', {
      ...ready,
      unclassifiedDifferences: 1,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('blocking conditions');
  });
});