import { describe, expect, it } from 'vitest';
import {
  commentEvidenceHash,
  hashEvidence,
  normalizeCommentCandidate,
  normalizeStarCandidate,
} from '../src/domains/social/candidateSocialMigration.js';

describe('candidate social migration utilities', () => {
  it('normalizes comments and derives their lifecycle without external calls', () => {
    expect(normalizeCommentCandidate({
      id: ' comment-1 ', subjectId: ' skill-1 ', authorId: ' user-1 ', body: ' hello\n  world ',
      createdAt: '2026-01-01T00:00:00-05:00', deletedAt: '2026-01-02T00:00:00Z',
    })).toEqual({
      id: 'comment-1', subjectId: 'skill-1', authorId: 'user-1', body: 'hello world',
      createdAt: '2026-01-01T05:00:00.000Z', updatedAt: null, deletedAt: '2026-01-02T00:00:00.000Z',
      status: 'deleted',
    });
  });

  it('normalizes stars and rejects incomplete candidate facts', () => {
    expect(normalizeStarCandidate({ subjectId: 'skill-1', actorId: 'user-1', createdAt: '2026-01-01' }))
      .toMatchObject({ subjectId: 'skill-1', actorId: 'user-1', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(() => normalizeStarCandidate({ subjectId: '', actorId: 'user-1', createdAt: '2026-01-01' })).toThrow('subjectId is required');
  });

  it('hashes equivalent evidence identically regardless of object key order', () => {
    expect(hashEvidence({ b: [2, { z: true }], a: 1 })).toBe(hashEvidence({ a: 1, b: [2, { z: true }] }));
    expect(commentEvidenceHash({ id: 'c', subjectId: 's', authorId: 'u', body: 'one  two', createdAt: '2026-01-01' }))
      .toBe(commentEvidenceHash({ authorId: 'u', body: 'one two', createdAt: '2026-01-01T00:00:00Z', id: 'c', subjectId: 's' }));
  });
});