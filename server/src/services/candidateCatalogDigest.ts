import { createHash } from 'node:crypto';

export type CandidateCatalogSource = {
  agentId: string;
  agentVersionId: string;
  displayName: string;
  summary: string | null;
  categoryKey: string | null;
  capabilitySummary: unknown;
  appearanceAssetId: string | null;
  availability: string;
  priceStatus: string;
};

export type CandidateCatalogDigest = CandidateCatalogSource & {
  searchText: string;
  sourceRevision: string;
};

const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`;
};

export const buildCandidateCatalogDigest = (
  source: CandidateCatalogSource,
): CandidateCatalogDigest => {
  const normalized = {
    ...source,
    displayName: source.displayName.trim(),
    summary: source.summary?.trim() || null,
    categoryKey: source.categoryKey?.trim() || null,
    availability: source.availability.trim(),
    priceStatus: source.priceStatus.trim(),
  };
  const searchText = [normalized.displayName, normalized.summary, normalized.categoryKey]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLocaleLowerCase('zh-CN');
  const sourceRevision = createHash('sha256')
    .update(stableJson(normalized))
    .digest('hex');

  return { ...normalized, searchText, sourceRevision };
};

export const candidateCatalogDigestChanged = (
  current: Pick<CandidateCatalogDigest, 'sourceRevision'> | null,
  next: CandidateCatalogDigest,
): boolean => current?.sourceRevision !== next.sourceRevision;

export const encodeCatalogCursor = (input: { displayName: string; agentId: string }): string =>
  Buffer.from(JSON.stringify(input)).toString('base64url');

export const decodeCatalogCursor = (cursor: string | undefined): { displayName: string; agentId: string } | null => {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const value = parsed as Record<string, unknown>;
    if (typeof value.displayName !== 'string' || typeof value.agentId !== 'string') return null;
    return { displayName: value.displayName, agentId: value.agentId };
  } catch {
    return null;
  }
};