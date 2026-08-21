import { describe, expect, it } from 'bun:test';
import {
  decodeProfileIncrementalCursor,
  encodeProfileIncrementalCursor,
  profileIncrementalWindowStart,
} from '../src/domains/profiles/profileIncrementalCursor.js';

describe('profile incremental cursor', () => {
  it('round-trips a fixed watermark and opaque source cursor', () => {
    const cursor = encodeProfileIncrementalCursor({
      cursor: 'convex-cursor',
      watermark: 42,
      windowStart: 40,
    });
    expect(decodeProfileIncrementalCursor(cursor)).toEqual({
      cursor: 'convex-cursor',
      watermark: 42,
      windowStart: 40,
    });
  });

  it('rejects malformed or unsupported persisted values', () => {
    expect(decodeProfileIncrementalCursor('{"version":2,"cursor":null,"watermark":1}')).toBeNull();
    expect(decodeProfileIncrementalCursor('not-json')).toBeNull();
    expect(decodeProfileIncrementalCursor(null)).toBeNull();
  });

  it('calculates an overlap window without crossing the epoch', () => {
    expect(profileIncrementalWindowStart(10_000, 1_000)).toBe(9_000);
    expect(profileIncrementalWindowStart(100, 1_000)).toBe(0);
  });
});