import { describe, expect, it } from 'bun:test';
import {
  decideIdempotencyEvent,
  decideLeaseAcquire,
  decideLeaseRelease,
  decideLeaseRenew,
  reconcileCheckpoint,
  type Lease,
} from '../src/domains/runtime/runtimeFoundation.js';

const now = new Date('2026-08-21T12:00:00.000Z');
const activeLease: Lease = {
  ownerId: 'worker-a',
  token: 'claim-a',
  expiresAt: new Date('2026-08-21T12:00:10.000Z'),
};

describe('runtime lease decisions', () => {
  it('acquires a missing or expired lease but leaves an active foreign lease untouched', () => {
    expect(decideLeaseAcquire({ current: null, ownerId: 'worker-a', token: 'claim-a', now, durationMs: 5_000 }))
      .toEqual({ kind: 'acquired', lease: { ...activeLease, expiresAt: new Date('2026-08-21T12:00:05.000Z') } });
    expect(decideLeaseAcquire({
      current: { ...activeLease, expiresAt: now },
      ownerId: 'worker-b', token: 'claim-b', now, durationMs: 5_000,
    })).toMatchObject({ kind: 'acquired', lease: { ownerId: 'worker-b', token: 'claim-b' } });
    expect(decideLeaseAcquire({ current: activeLease, ownerId: 'worker-b', token: 'claim-b', now, durationMs: 5_000 }))
      .toEqual({ kind: 'unavailable', lease: activeLease });
  });

  it('makes repeated acquisition idempotent and requires the claim token to renew or release', () => {
    expect(decideLeaseAcquire({ current: activeLease, ownerId: 'worker-a', token: 'claim-a', now, durationMs: 5_000 }))
      .toEqual({ kind: 'already-held', lease: activeLease });
    expect(decideLeaseRenew({ current: activeLease, ownerId: 'worker-a', token: 'claim-a', now, durationMs: 5_000 }))
      .toEqual({ kind: 'renewed', lease: { ...activeLease, expiresAt: new Date('2026-08-21T12:00:05.000Z') } });
    expect(decideLeaseRenew({ current: activeLease, ownerId: 'worker-a', token: 'wrong', now, durationMs: 5_000 }))
      .toEqual({ kind: 'not-holder', lease: activeLease });
    expect(decideLeaseRelease({ current: activeLease, ownerId: 'worker-a', token: 'wrong' }))
      .toEqual({ kind: 'not-holder', lease: activeLease });
    expect(decideLeaseRelease({ current: activeLease, ownerId: 'worker-a', token: 'claim-a' }))
      .toEqual({ kind: 'released' });
  });

  it('does not revive an expired lease through renewal', () => {
    expect(decideLeaseRenew({
      current: { ...activeLease, expiresAt: now }, ownerId: 'worker-a', token: 'claim-a', now, durationMs: 5_000,
    })).toMatchObject({ kind: 'expired' });
    expect(() => decideLeaseAcquire({ current: null, ownerId: 'worker-a', token: 'claim-a', now, durationMs: 0 }))
      .toThrow('positive safe integer');
  });
});

describe('runtime idempotency decisions', () => {
  it('starts new events, reports in-flight duplicates, and replays completed responses', () => {
    expect(decideIdempotencyEvent({ existing: null, key: 'event-1', payloadHash: 'hash-a' }))
      .toEqual({ kind: 'process', event: { key: 'event-1', payloadHash: 'hash-a', status: 'processing', response: null } });
    const inFlight = { key: 'event-1', payloadHash: 'hash-a', status: 'processing' as const, response: null };
    expect(decideIdempotencyEvent({ existing: inFlight, key: 'event-1', payloadHash: 'hash-a' }))
      .toEqual({ kind: 'in-progress', event: inFlight });
    const completed = { ...inFlight, status: 'completed' as const, response: { accepted: true } };
    expect(decideIdempotencyEvent({ existing: completed, key: 'event-1', payloadHash: 'hash-a' }))
      .toEqual({ kind: 'replay', event: completed, response: { accepted: true } });
  });

  it('rejects key reuse with a different payload and permits same-payload failed work to retry', () => {
    const failed = { key: 'event-1', payloadHash: 'hash-a', status: 'failed' as const, response: { reason: 'timeout' } };
    expect(decideIdempotencyEvent({ existing: failed, key: 'event-1', payloadHash: 'hash-b' }))
      .toEqual({ kind: 'conflict', event: failed });
    expect(decideIdempotencyEvent({ existing: failed, key: 'event-1', payloadHash: 'hash-a' }))
      .toEqual({ kind: 'process', event: { ...failed, status: 'processing', response: null } });
  });
});

describe('runtime checkpoint reconciliation', () => {
  it('starts, advances, and completes only against a stable source watermark', () => {
    expect(reconcileCheckpoint({ current: null, sourceWatermark: 'snapshot-1', nextCursor: 'cursor-1', sourceExhausted: false }))
      .toEqual({ kind: 'start', checkpoint: { cursor: 'cursor-1', watermark: 'snapshot-1', completed: false } });
    const current = { cursor: 'cursor-1', watermark: 'snapshot-1', completed: false };
    expect(reconcileCheckpoint({ current, sourceWatermark: 'snapshot-1', nextCursor: null, sourceExhausted: true }))
      .toEqual({ kind: 'complete', checkpoint: { cursor: null, watermark: 'snapshot-1', completed: true } });
    expect(reconcileCheckpoint({ current, sourceWatermark: 'snapshot-2', nextCursor: 'cursor-2', sourceExhausted: false }))
      .toEqual({ kind: 'watermark-mismatch', checkpoint: current });
  });

  it('does not reopen a completed checkpoint', () => {
    const completed = { cursor: null, watermark: 'snapshot-1', completed: true };
    expect(reconcileCheckpoint({ current: completed, sourceWatermark: 'snapshot-1', nextCursor: 'cursor-2', sourceExhausted: false }))
      .toEqual({ kind: 'already-complete', checkpoint: completed });
  });
});