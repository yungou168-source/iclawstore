import { randomUUID } from 'node:crypto';

/**
 * AI Direct Hiring — Request ID extraction utility.
 *
 * Per the desktop contract (ai-direct-hiring-desktop-contract.md):
 * - Clients SHOULD send X-Request-Id; if absent the server generates one.
 * - The request ID is written into AuditEvent.requestId and OutboxEvent
 *   for end-to-end traceability.
 *
 * Usage:
 * ```ts
 * import { extractRequestId } from '../utils/requestId.js';
 * const requestId = extractRequestId(request);
 * ```
 */

/**
 * Extract X-Request-Id from request headers.
 * Falls back to a random UUID if absent or invalid.
 * Caps at 128 characters per the API contract.
 */
export function extractRequestId(request: { headers: Record<string, unknown> }): string {
  const value = request.headers['x-request-id'];
  if (typeof value === 'string' && value.length > 0 && value.length <= 128) {
    return value;
  }
  return randomUUID();
}
