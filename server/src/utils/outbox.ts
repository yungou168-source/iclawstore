import { randomUUID } from 'node:crypto';

export type OutboxEventInput = {
  organizationId: string | null;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
};

/**
 * Append a projection event to `ai_direct_outbox_events` inside an
 * existing transaction (connection).  This is called from route handlers
 * alongside `INSERT INTO ai_direct_audit_events` in the same transaction
 * so that the outbox row is committed atomically with the authoritative
 * state change.
 *
 * The outbox processor (a separate background worker) reads pending rows,
 * publishes to downstream systems, and marks them `published`.
 */
export async function publishOutboxEvent(
  connection: {
    query(sql: string, values?: unknown[]): Promise<unknown>;
  },
  input: OutboxEventInput,
): Promise<void> {
  await connection.query(
    `INSERT INTO ai_direct_outbox_events
     (id, organizationId, aggregateType, aggregateId, eventType, payloadVersion, payload)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
    [
      randomUUID(),
      input.organizationId,
      input.aggregateType,
      input.aggregateId,
      input.eventType,
      JSON.stringify(input.payload),
    ],
  );
}
