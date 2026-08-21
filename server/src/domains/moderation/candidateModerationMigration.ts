import { hashEvidence } from '../social/candidateSocialMigration.js';

export type ReportCandidate = Readonly<{
  id: string;
  subjectId: string;
  reporterId: string;
  reason: string;
  details: string | null;
  createdAt: string;
  resolvedAt: string | null;
  status: 'open' | 'resolved';
}>;

export type AppealCandidate = Readonly<{
  id: string;
  reportId: string;
  appellantId: string;
  body: string;
  createdAt: string;
  decidedAt: string | null;
  status: 'pending' | 'decided';
}>;

export type EvidenceClassification =
  | 'matched'
  | 'source_missing'
  | 'candidate_missing'
  | 'evidence_mismatch'
  | 'unclassified';

export type CandidateReadiness = Readonly<{
  ready: boolean;
  total: number;
  matched: number;
  sourceMissing: number;
  candidateMissing: number;
  mismatched: number;
  unclassified: number;
  blockingClassifications: readonly EvidenceClassification[];
}>;

type ReportInput = Readonly<{
  id: unknown;
  subjectId: unknown;
  reporterId: unknown;
  reason: unknown;
  details?: unknown;
  createdAt: unknown;
  resolvedAt?: unknown;
}>;

type AppealInput = Readonly<{
  id: unknown;
  reportId: unknown;
  appellantId: unknown;
  body: unknown;
  createdAt: unknown;
  decidedAt?: unknown;
}>;

const text = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
};

const time = (value: unknown, field: string): string => {
  const parsed = new Date(text(value, field));
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be a valid timestamp`);
  return parsed.toISOString();
};

const optionalTime = (value: unknown, field: string): string | null =>
  value === undefined || value === null || value === '' ? null : time(value, field);

export const normalizeReportCandidate = (input: ReportInput): ReportCandidate => {
  const resolvedAt = optionalTime(input.resolvedAt, 'resolvedAt');
  return {
    id: text(input.id, 'id'),
    subjectId: text(input.subjectId, 'subjectId'),
    reporterId: text(input.reporterId, 'reporterId'),
    reason: text(input.reason, 'reason').toLowerCase().replace(/\s+/g, '_'),
    details: typeof input.details === 'string' && input.details.trim()
      ? input.details.trim().replace(/\s+/g, ' ')
      : null,
    createdAt: time(input.createdAt, 'createdAt'),
    resolvedAt,
    status: resolvedAt ? 'resolved' : 'open',
  };
};

export const normalizeAppealCandidate = (input: AppealInput): AppealCandidate => {
  const decidedAt = optionalTime(input.decidedAt, 'decidedAt');
  return {
    id: text(input.id, 'id'),
    reportId: text(input.reportId, 'reportId'),
    appellantId: text(input.appellantId, 'appellantId'),
    body: text(input.body, 'body').replace(/\s+/g, ' '),
    createdAt: time(input.createdAt, 'createdAt'),
    decidedAt,
    status: decidedAt ? 'decided' : 'pending',
  };
};

export const reportEvidenceHash = (input: ReportInput): string => hashEvidence(normalizeReportCandidate(input));
export const appealEvidenceHash = (input: AppealInput): string => hashEvidence(normalizeAppealCandidate(input));

export const classifyEvidence = (
  sourceHash: string | null | undefined,
  candidateHash: string | null | undefined,
): EvidenceClassification => {
  if (sourceHash === undefined || candidateHash === undefined) return 'unclassified';
  if (sourceHash === null) return candidateHash === null ? 'unclassified' : 'source_missing';
  if (candidateHash === null) return 'candidate_missing';
  return sourceHash === candidateHash ? 'matched' : 'evidence_mismatch';
};

export const aggregateCandidateReadiness = (
  classifications: readonly EvidenceClassification[],
): CandidateReadiness => {
  const counts = classifications.reduce<Record<EvidenceClassification, number>>(
    (result, classification) => ({ ...result, [classification]: result[classification] + 1 }),
    { matched: 0, source_missing: 0, candidate_missing: 0, evidence_mismatch: 0, unclassified: 0 },
  );
  const blockingClassifications = classifications.filter((value) => value !== 'matched');
  return {
    ready: blockingClassifications.length === 0,
    total: classifications.length,
    matched: counts.matched,
    sourceMissing: counts.source_missing,
    candidateMissing: counts.candidate_missing,
    mismatched: counts.evidence_mismatch,
    unclassified: counts.unclassified,
    blockingClassifications,
  };
};