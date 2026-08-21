export type Lease = Readonly<{
  ownerId: string;
  token: string;
  expiresAt: Date;
}>;

export type LeaseAcquireDecision =
  | Readonly<{ kind: 'acquired'; lease: Lease }>
  | Readonly<{ kind: 'already-held'; lease: Lease }>
  | Readonly<{ kind: 'unavailable'; lease: Lease }>;

const validDuration = (durationMs: number): void => {
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    throw new Error('Lease duration must be a positive safe integer');
  }
};

const sameLeaseHolder = (lease: Lease, ownerId: string, token: string): boolean =>
  lease.ownerId === ownerId && lease.token === token;

const isExpired = (lease: Lease, now: Date): boolean => lease.expiresAt.getTime() <= now.getTime();

const newLease = (ownerId: string, token: string, now: Date, durationMs: number): Lease => ({
  ownerId,
  token,
  expiresAt: new Date(now.getTime() + durationMs),
});

/** Decides whether an atomic persistence layer may claim a lease. */
export const decideLeaseAcquire = (input: Readonly<{
  current: Lease | null;
  ownerId: string;
  token: string;
  now: Date;
  durationMs: number;
}>): LeaseAcquireDecision => {
  validDuration(input.durationMs);
  if (input.current === null || isExpired(input.current, input.now)) {
    return { kind: 'acquired', lease: newLease(input.ownerId, input.token, input.now, input.durationMs) };
  }
  if (sameLeaseHolder(input.current, input.ownerId, input.token)) {
    return { kind: 'already-held', lease: input.current };
  }
  return { kind: 'unavailable', lease: input.current };
};

export type LeaseRenewDecision =
  | Readonly<{ kind: 'renewed'; lease: Lease }>
  | Readonly<{ kind: 'not-holder' | 'expired'; lease: Lease | null }>;

/** Renewal never revives an expired lease; it must be acquired again. */
export const decideLeaseRenew = (input: Readonly<{
  current: Lease | null;
  ownerId: string;
  token: string;
  now: Date;
  durationMs: number;
}>): LeaseRenewDecision => {
  validDuration(input.durationMs);
  if (input.current === null || !sameLeaseHolder(input.current, input.ownerId, input.token)) {
    return { kind: 'not-holder', lease: input.current };
  }
  if (isExpired(input.current, input.now)) return { kind: 'expired', lease: input.current };
  return { kind: 'renewed', lease: newLease(input.ownerId, input.token, input.now, input.durationMs) };
};

export type LeaseReleaseDecision =
  | Readonly<{ kind: 'released' }>
  | Readonly<{ kind: 'not-holder'; lease: Lease | null }>;

/** A stale holder cannot release a lease that has been re-acquired by another worker. */
export const decideLeaseRelease = (input: Readonly<{
  current: Lease | null;
  ownerId: string;
  token: string;
}>): LeaseReleaseDecision =>
  input.current !== null && sameLeaseHolder(input.current, input.ownerId, input.token)
    ? { kind: 'released' }
    : { kind: 'not-holder', lease: input.current };

export type IdempotencyEvent = Readonly<{
  key: string;
  payloadHash: string;
  status: 'processing' | 'completed' | 'failed';
  response: unknown | null;
}>;

export type IdempotencyDecision =
  | Readonly<{ kind: 'process'; event: IdempotencyEvent }>
  | Readonly<{ kind: 'in-progress'; event: IdempotencyEvent }>
  | Readonly<{ kind: 'replay'; event: IdempotencyEvent; response: unknown }>
  | Readonly<{ kind: 'conflict'; event: IdempotencyEvent }>;

/**
 * Distinguishes a safe replay from a key reused with a different request body.
 * A failed event may be retried only by the same key and payload hash.
 */
export const decideIdempotencyEvent = (input: Readonly<{
  existing: IdempotencyEvent | null;
  key: string;
  payloadHash: string;
}>): IdempotencyDecision => {
  const event = input.existing;
  if (event === null) {
    return { kind: 'process', event: { key: input.key, payloadHash: input.payloadHash, status: 'processing', response: null } };
  }
  if (event.key !== input.key || event.payloadHash !== input.payloadHash) return { kind: 'conflict', event };
  if (event.status === 'completed') {
    if (event.response === null) return { kind: 'conflict', event };
    return { kind: 'replay', event, response: event.response };
  }
  if (event.status === 'processing') return { kind: 'in-progress', event };
  return { kind: 'process', event: { ...event, status: 'processing', response: null } };
};

export type ReconciliationCheckpoint = Readonly<{
  cursor: string | null;
  watermark: string;
  completed: boolean;
}>;

export type CheckpointReconciliationDecision =
  | Readonly<{ kind: 'start'; checkpoint: ReconciliationCheckpoint }>
  | Readonly<{ kind: 'advance'; checkpoint: ReconciliationCheckpoint }>
  | Readonly<{ kind: 'complete'; checkpoint: ReconciliationCheckpoint }>
  | Readonly<{ kind: 'already-complete'; checkpoint: ReconciliationCheckpoint }>
  | Readonly<{ kind: 'watermark-mismatch'; checkpoint: ReconciliationCheckpoint }>;

/**
 * Produces the next durable checkpoint only when the source snapshot watermark is
 * unchanged. The caller persists this together with that page's reconciliation
 * results in one MySQL transaction.
 */
export const reconcileCheckpoint = (input: Readonly<{
  current: ReconciliationCheckpoint | null;
  sourceWatermark: string;
  nextCursor: string | null;
  sourceExhausted: boolean;
}>): CheckpointReconciliationDecision => {
  const checkpoint = input.current;
  if (checkpoint === null) {
    const next = { cursor: input.sourceExhausted ? null : input.nextCursor, watermark: input.sourceWatermark, completed: input.sourceExhausted };
    return input.sourceExhausted ? { kind: 'complete', checkpoint: next } : { kind: 'start', checkpoint: next };
  }
  if (checkpoint.completed) return { kind: 'already-complete', checkpoint };
  if (checkpoint.watermark !== input.sourceWatermark) return { kind: 'watermark-mismatch', checkpoint };
  const next = { cursor: input.sourceExhausted ? null : input.nextCursor, watermark: checkpoint.watermark, completed: input.sourceExhausted };
  return input.sourceExhausted ? { kind: 'complete', checkpoint: next } : { kind: 'advance', checkpoint: next };
};