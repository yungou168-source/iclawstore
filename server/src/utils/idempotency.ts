import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { FastifyRequest } from 'fastify';
import { Pool, PoolConnection } from 'mysql2/promise';
import { AiDirectHiringError, ErrorCodes } from '../services/aiDirectErrors.js';

/**
 * AI Direct Hiring — Idempotency key & fingerprint utilities.
 *
 * Based on the pattern in aiDirectOrganizations.ts:
 * - `Idempotency-Key` header: user-provided, unique per (user, route)
 * - Fingerprint: SHA-256 of the normalized request body, used to detect
 *   key reuse with different intent (conflicting replay).
 */

// ---------------------------------------------------------------------------
// Request ID (traceability — not the same as idempotency)
// ---------------------------------------------------------------------------

export interface RequestContext {
  requestId: string;
  idempotencyKey: string | null;
}

/**
 * Extract or generate X-Request-Id.
 */
export function extractRequestId(request: { headers: Record<string, unknown> }): string {
  const value = request.headers['x-request-id'];
  if (typeof value === 'string' && value.length > 0 && value.length <= 128) {
    return value;
  }
  return randomUUID();
}

/**
 * Parse the Idempotency-Key header from a Fastify request.
 * Returns null if absent; throws if malformed.
 */
export function parseIdempotencyKey(request: { headers: Record<string, unknown> }): string | null {
  const value = request.headers['idempotency-key'];
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new IdempotencyError(ErrorCodes.IDEMPOTENCY_KEY_INVALID, 'Idempotency-Key 长度必须为 1 到 128 字符');
  }
  return value;
}

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

/**
 * Compute a stable SHA-256 fingerprint from a request body.
 * Strips keys that should NOT be fingerprinted (e.g. idempotency keys,
 * client-side timestamps, request IDs).
 */
export function idempotencyFingerprint(body: unknown): string {
  const sanitized = stripNonDeterministicKeys(body);
  return createHash('sha256').update(JSON.stringify(sanitized)).digest('hex');
}

function stripNonDeterministicKeys(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(stripNonDeterministicKeys);
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))) {
      const lower = k.toLowerCase();
      if (
        lower === 'idempotencykey' ||
        lower === 'idempotency-key' ||
        lower === 'xrequestid' ||
        lower === 'requestid' ||
        lower === 'x-request-id' ||
        lower === 'timestamp' ||
        lower === 'clienttimestamp'
      ) {
        continue;
      }
      result[k] = stripNonDeterministicKeys(v);
    }
    return result;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Idempotency wrapper
// ---------------------------------------------------------------------------

export class IdempotencyError extends AiDirectHiringError {
  constructor(code: typeof ErrorCodes.IDEMPOTENCY_KEY_INVALID | typeof ErrorCodes.IDEMPOTENCY_KEY_REUSED, message: string) {
    super(code, message, code === ErrorCodes.IDEMPOTENCY_KEY_REUSED ? 409 : 400);
    this.name = 'IdempotencyError';
  }
}

/**
 * Options for withIdempotency.
 */
export interface IdempotencyOptions {
  /** Column name for the idempotency key (e.g. 'idempotencyKey') */
  keyColumn: string;
  /** Column name for the fingerprint (e.g. 'idempotencyFingerprint') */
  fingerprintColumn: string;
  /** Table name to check for duplicate */
  table: string;
  /** WHERE clause for the lookup (e.g. 'ownerUserId = ?') */
  whereClause: string;
  /** Parameters for the WHERE clause */
  whereParams: unknown[];
  /** Scope of the idempotency key (e.g. 'user') */
  scope?: string;
}

export interface IdempotencyResult<T> {
  replayed: boolean;
  existingId?: string;
  value?: T;
}

/**
 * Guard a write operation with idempotency.
 *
 * Returns:
 * - { replayed: false }   → proceed with the write
 * - { replayed: true, existingId } → return 200 replay response
 *
 * Throws IdempotencyError on fingerprint mismatch (409).
 *
 * Usage:
 * ```ts
 * const result = await withIdempotency(pool, {
 *   keyColumn: 'idempotencyKey',
 *   fingerprintColumn: 'idempotencyFingerprint',
 *   table: 'ai_direct_companies',
 *   whereClause: 'ownerUserId = ? AND idempotencyKey = ?',
 *   whereParams: [userId, idempotencyKey],
 * }, async () => { /* do the insert *\/ });
 * if (result.replayed) return reply.status(200).send({ id: result.existingId, replayed: true });
 * ```
 */
export async function withIdempotency<T>(
  pool: Pool,
  options: IdempotencyOptions,
  fingerprint: string,
  work: () => Promise<T>,
): Promise<IdempotencyResult<T>> {
  const { keyColumn, fingerprintColumn, table, whereClause, whereParams } = options;

  const [rows] = await pool.query(
    `SELECT id, ${fingerprintColumn} AS storedFingerprint FROM \`${table}\` WHERE ${whereClause} LIMIT 1`,
    whereParams,
  );
  const existing = (rows as Array<{ id: string; storedFingerprint: string | null }>)[0];

  if (existing) {
    if (existing.storedFingerprint !== fingerprint) {
      throw new IdempotencyError(ErrorCodes.IDEMPOTENCY_KEY_REUSED, '幂等键已被用于不同的创建请求');
    }
    return { replayed: true, existingId: existing.id };
  }

  const value = await work();
  return { replayed: false, value };
}

/**
 * Lightweight guard using a shared idempotency lock table.
 * Use when the target table doesn't have idempotency columns.
 */
export async function withIdempotencyLock(
  pool: Pool,
  scope: string,
  key: string,
  ttlSeconds = 86400,
  work: () => Promise<void>,
): Promise<boolean> {
  const lockKey = `${scope}:${key}`;
  const lockId = randomUUID();
  try {
    await pool.query(
      `INSERT INTO idempotency_locks (\`key\`, lockId, lockedAt, expiresAt)
       VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? SECOND))
       ON DUPLICATE KEY UPDATE lockId = IF(expiresAt < NOW(), VALUES(lockId), lockId),
         lockedAt = IF(expiresAt < NOW(), VALUES(lockedAt), lockedAt),
         expiresAt = IF(expiresAt < NOW(), VALUES(expiresAt), expiresAt)`,
      [lockKey, lockId, ttlSeconds],
    );
    const [rows] = await pool.query(
      `SELECT lockId FROM idempotency_locks WHERE \`key\` = ? AND lockId = ? AND expiresAt > NOW()`,
      [lockKey, lockId],
    );
    if (!(rows as any[]).length) {
      return false; // lock held by another request
    }
    await work();
    return true;
  } finally {
    await pool.query(
      `DELETE FROM idempotency_locks WHERE \`key\` = ? AND lockId = ?`,
      [lockKey, lockId],
    );
  }
}
