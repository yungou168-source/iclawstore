import { describe, expect, it } from 'vitest';
import {
  aggregateCandidateReadiness,
  appealEvidenceHash,
  classifyEvidence,
  normalizeAppealCandidate,
  normalizeReportCandidate,
  reportEvidenceHash,
} from '../src/domains/moderation/candidateModerationMigration.js';

describe('candidate moderation migration utilities', () => {
  it('normalizes report and appeal states deterministically', () => {
    expect(normalizeReportCandidate({ id: 'r', subjectId: 's', reporterId: 'u', reason: ' Harassment Report ', details: ' details\n here ', createdAt: '2026-01-01' }))
      .toMatchObject({ reason: 'harassment_report', details: 'details here', status: 'open', resolvedAt: null });
    expect(normalizeAppealCandidate({ id: 'a', reportId: 'r', appellantId: 'u', body: 'please  review', createdAt: '2026-01-01', decidedAt: '2026-01-02' }))
      .toMatchObject({ body: 'please review', status: 'decided' });
    expect(reportEvidenceHash({ id: 'r', subjectId: 's', reporterId: 'u', reason: 'spam', createdAt: '2026-01-01' })).toHaveLength(64);
    expect(appealEvidenceHash({ id: 'a', reportId: 'r', appellantId: 'u', body: 'review', createdAt: '2026-01-01' })).toHaveLength(64);
  });

  it('classifies evidence and blocks readiness for every unresolved class', () => {
    expect(classifyEvidence('same', 'same')).toBe('matched');
    expect(classifyEvidence(null, 'candidate')).toBe('source_missing');
    expect(classifyEvidence('source', null)).toBe('candidate_missing');
    expect(classifyEvidence('source', 'candidate')).toBe('evidence_mismatch');
    expect(classifyEvidence(undefined, 'candidate')).toBe('unclassified');
    expect(aggregateCandidateReadiness(['matched', 'candidate_missing', 'unclassified'])).toEqual({
      ready: false, total: 3, matched: 1, sourceMissing: 0, candidateMissing: 1, mismatched: 0,
      unclassified: 1, blockingClassifications: ['candidate_missing', 'unclassified'],
    });
    expect(aggregateCandidateReadiness(['matched']).ready).toBe(true);
  });
});