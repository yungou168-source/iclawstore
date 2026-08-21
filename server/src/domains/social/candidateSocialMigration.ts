import { createHash } from 'node:crypto';

export type CommentCandidate = Readonly<{
  id: string;
  subjectId: string;
  authorId: string;
  body: string;
  createdAt: string;
  updatedAt: string | null;
  deletedAt: string | null;
  status: 'active' | 'deleted';
}>;

export type StarCandidate = Readonly<{
  subjectId: string;
  actorId: string;
  createdAt: string;
}>;

type CommentInput = Readonly<{
  id: unknown;
  subjectId: unknown;
  authorId: unknown;
  body: unknown;
  createdAt: unknown;
  updatedAt?: unknown;
  deletedAt?: unknown;
}>;

type StarInput = Readonly<{
  subjectId: unknown;
  actorId: unknown;
  createdAt: unknown;
}>;

const requiredText = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
};

const optionalTime = (value: unknown, field: string): string | null => {
  if (value === null || value === undefined || value === '') return null;
  return requiredTime(value, field);
};

const requiredTime = (value: unknown, field: string): string => {
  const time = new Date(requiredText(value, field));
  if (Number.isNaN(time.getTime())) throw new Error(`${field} must be a valid timestamp`);
  return time.toISOString();
};

/** Canonical JSON for candidate evidence; object key order never affects the result. */
export const stableEvidenceValue = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableEvidenceValue).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableEvidenceValue(entry)}`)
    .join(',')}}`;
};

export const hashEvidence = (value: unknown): string =>
  createHash('sha256').update(stableEvidenceValue(value)).digest('hex');

export const normalizeCommentCandidate = (input: CommentInput): CommentCandidate => {
  const deletedAt = optionalTime(input.deletedAt, 'deletedAt');
  return {
    id: requiredText(input.id, 'id'),
    subjectId: requiredText(input.subjectId, 'subjectId'),
    authorId: requiredText(input.authorId, 'authorId'),
    body: requiredText(input.body, 'body').replace(/\s+/g, ' '),
    createdAt: requiredTime(input.createdAt, 'createdAt'),
    updatedAt: optionalTime(input.updatedAt, 'updatedAt'),
    deletedAt,
    status: deletedAt ? 'deleted' : 'active',
  };
};

export const normalizeStarCandidate = (input: StarInput): StarCandidate => ({
  subjectId: requiredText(input.subjectId, 'subjectId'),
  actorId: requiredText(input.actorId, 'actorId'),
  createdAt: requiredTime(input.createdAt, 'createdAt'),
});

export const commentEvidenceHash = (input: CommentInput): string =>
  hashEvidence(normalizeCommentCandidate(input));

export const starEvidenceHash = (input: StarInput): string =>
  hashEvidence(normalizeStarCandidate(input));