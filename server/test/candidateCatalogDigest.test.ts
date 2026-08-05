import { describe, expect, it } from 'bun:test';
import {
  buildCandidateCatalogDigest,
  candidateCatalogDigestChanged,
  decodeCatalogCursor,
  encodeCatalogCursor,
} from '../src/services/candidateCatalogDigest.js';

describe('candidateCatalogDigest', () => {
  const source = {
    agentId: 'agent-1',
    agentVersionId: 'version-1',
    displayName: '  Research Agent  ',
    summary: '  Summarizes records  ',
    categoryKey: '  research  ',
    capabilitySummary: ['summary'],
    appearanceAssetId: null,
    availability: 'available',
    priceStatus: 'internal_use',
  };

  it('normalizes only catalog-safe fields into a stable digest', () => {
    const digest = buildCandidateCatalogDigest(source);
    expect(digest.displayName).toBe('Research Agent');
    expect(digest.searchText).toContain('research agent');
    expect(candidateCatalogDigestChanged({ sourceRevision: digest.sourceRevision }, digest)).toBe(false);
    expect(candidateCatalogDigestChanged(null, digest)).toBe(true);
  });

  it('keeps revisions stable when capability object keys are reordered', () => {
    const first = buildCandidateCatalogDigest({ ...source, capabilitySummary: { summarize: true, classify: false } });
    const second = buildCandidateCatalogDigest({ ...source, capabilitySummary: { classify: false, summarize: true } });
    expect(first.sourceRevision).toBe(second.sourceRevision);
  });

  it('round-trips opaque cursors and rejects malformed values', () => {
    const cursor = encodeCatalogCursor({ displayName: 'Research Agent', agentId: 'agent-1' });
    expect(decodeCatalogCursor(cursor)).toEqual({ displayName: 'Research Agent', agentId: 'agent-1' });
    expect(decodeCatalogCursor('not-a-cursor')).toBeNull();
  });
});