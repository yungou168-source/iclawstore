export type CandidateReadinessReport = Readonly<{
  domain: string;
  candidateReady: boolean;
  unresolvedDifferences: number;
  unclassifiedDifferences: number;
  pendingAssets: number;
  failedAssets: number;
  checkpointComplete: boolean;
}>;

export type CandidateReadinessDecision = Readonly<{
  allowed: boolean;
  environment: 'candidate';
  readMode: 'candidate_only';
  rollbackReadMode: 'convex_authoritative';
  reason: string | null;
}>;

export const decideCandidateReadiness = (
  environment: string | undefined,
  report: CandidateReadinessReport,
): CandidateReadinessDecision => {
  if (environment !== 'candidate') {
    return {
      allowed: false,
      environment: 'candidate',
      readMode: 'candidate_only',
      rollbackReadMode: 'convex_authoritative',
      reason: 'candidate-only gate rejects non-candidate environments',
    };
  }

  const blocked = [
    report.candidateReady !== true,
    report.unresolvedDifferences !== 0,
    report.unclassifiedDifferences !== 0,
    report.pendingAssets !== 0,
    report.failedAssets !== 0,
    report.checkpointComplete !== true,
  ];
  if (blocked.some(Boolean)) {
    return {
      allowed: false,
      environment: 'candidate',
      readMode: 'candidate_only',
      rollbackReadMode: 'convex_authoritative',
      reason: 'candidate readiness report contains blocking conditions',
    };
  }

  return {
    allowed: true,
    environment: 'candidate',
    readMode: 'candidate_only',
    rollbackReadMode: 'convex_authoritative',
    reason: null,
  };
};