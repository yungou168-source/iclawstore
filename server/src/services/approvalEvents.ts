import { randomUUID } from 'node:crypto';

export type ApprovalEventInput = {
  approvalId: string;
  organizationId: string | null;
  eventType: string;
  actorUserId: string | null;
  requestId: string;
  metadata?: Record<string, unknown>;
};

type SqlConnection = {
  query(sql: string, values?: unknown[]): Promise<unknown>;
};

/**
 * The caller must hold a row lock on the approval. This serializes the local
 * sequence without making the mutable approval row a history store.
 */
export async function appendApprovalEvent(
  conn: SqlConnection,
  input: ApprovalEventInput,
): Promise<string> {
  const [rows] = await conn.query(
    'SELECT COALESCE(MAX(sequence), 0) + 1 AS nextSequence FROM ai_direct_approval_events WHERE approvalId = ?',
    [input.approvalId],
  ) as [Array<{ nextSequence: number }>];
  const id = randomUUID();
  await conn.query(
    `INSERT INTO ai_direct_approval_events
     (id, approvalId, organizationId, sequence, eventType, actorUserId, requestId, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.approvalId,
      input.organizationId,
      rows[0]?.nextSequence ?? 1,
      input.eventType,
      input.actorUserId,
      input.requestId,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );
  return id;
}