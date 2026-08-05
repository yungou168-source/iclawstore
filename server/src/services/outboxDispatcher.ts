import type { Pool, PoolConnection } from 'mysql2/promise';
import { enqueueWorkflowRun } from './jobQueue.js';
import {
  resolveWorkflowTemplate,
  type OutboxEvent,
} from './workflowTemplateRegistry.js';

const MAX_ATTEMPTS = 8;
const MAX_BACKOFF_SECONDS = 300;

export type DispatchResult =
  | { kind: 'idle' }
  | { kind: 'ignored'; eventId: string; eventType: string }
  | { kind: 'enqueued'; eventId: string; runId: string; workflowKey: string };

type OutboxRow = {
  id: string;
  organizationId: string | null;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  attempts: number;
};

type RuntimeContext = {
  organizationId: string | null;
  employmentId: string | null;
  agentVersionId: string | null;
  requestedByUserId: string;
};

function parsePayload(payload: unknown): Record<string, unknown> {
  const value = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Outbox payload must be a JSON object');
  }
  return value as Record<string, unknown>;
}

async function resolveRuntimeContext(
  conn: PoolConnection,
  row: OutboxRow,
  event: OutboxEvent,
): Promise<RuntimeContext> {
  const employmentId =
    typeof event.payload.employmentId === 'string'
      ? event.payload.employmentId
      : row.aggregateType === 'employment'
        ? row.aggregateId
        : null;

  if (!employmentId) {
    const actorUserId = event.payload.actorUserId;
    return {
      organizationId: row.organizationId,
      employmentId: null,
      agentVersionId: null,
      requestedByUserId: typeof actorUserId === 'string' ? actorUserId : 'system',
    };
  }

  const [rows] = (await conn.query(
    `SELECT c.organizationId, e.agentVersionId, e.requestedByUserId
     FROM ai_direct_employments e
     JOIN ai_direct_companies c ON c.id = e.companyId
     WHERE e.id = ? LIMIT 1`,
    [employmentId],
  )) as any;
  const employment = rows[0];
  if (!employment) {
    throw new Error(`Employment not found for outbox event ${row.id}`);
  }
  const actorUserId = event.payload.actorUserId;
  return {
    organizationId: row.organizationId ?? employment.organizationId ?? null,
    employmentId,
    agentVersionId: employment.agentVersionId ?? null,
    requestedByUserId:
      typeof actorUserId === 'string'
        ? actorUserId
        : employment.requestedByUserId ?? 'system',
  };
}

function failureBackoffSeconds(attempts: number): number {
  return Math.min(2 ** Math.max(0, attempts), MAX_BACKOFF_SECONDS);
}

export class OutboxDispatcher {
  constructor(private readonly pool: Pool) {}

  async dispatchNext(): Promise<DispatchResult> {
    const conn = await this.pool.getConnection();
    let claimed: OutboxRow | null = null;
    try {
      await conn.beginTransaction();
      const [rows] = (await conn.query(
        `SELECT id, organizationId, aggregateType, aggregateId, eventType, payload, attempts
         FROM ai_direct_outbox_events
         WHERE status = 'pending' AND availableAt <= NOW(3)
         ORDER BY occurredAt ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
      )) as any;
      claimed = rows[0] ?? null;
      if (!claimed) {
        await conn.rollback();
        return { kind: 'idle' };
      }

      const event: OutboxEvent = {
        id: claimed.id,
        aggregateType: claimed.aggregateType,
        aggregateId: claimed.aggregateId,
        eventType: claimed.eventType,
        payload: parsePayload(claimed.payload),
      };
      const template = resolveWorkflowTemplate(event);
      if (!template) {
        await conn.query(
          `UPDATE ai_direct_outbox_events
           SET status = 'published', publishedAt = NOW(), failureReason = NULL
           WHERE id = ? AND status = 'pending'`,
          [event.id],
        );
        await conn.commit();
        return { kind: 'ignored', eventId: event.id, eventType: event.eventType };
      }

      const context = await resolveRuntimeContext(conn, claimed, event);
      const result = await enqueueWorkflowRun(
        conn,
        {
          organizationId: context.organizationId,
          employmentId: context.employmentId,
          agentVersionId: context.agentVersionId,
          workflowKey: template.workflowKey,
          workflowVersion: template.workflowVersion,
          requestedByUserId: context.requestedByUserId,
          inputSummary: {
            sourceEventId: event.id,
            sourceEventType: event.eventType,
            aggregateType: event.aggregateType,
            aggregateId: event.aggregateId,
            payload: event.payload,
          },
          idempotencyKey: `outbox:${event.id}`,
          initialSteps: template.steps,
        },
        `outbox:${event.id}`,
      );
      await conn.query(
        `UPDATE ai_direct_outbox_events
         SET status = 'published', publishedAt = NOW(), failureReason = NULL
         WHERE id = ? AND status = 'pending'`,
        [event.id],
      );
      await conn.commit();
      return {
        kind: 'enqueued',
        eventId: event.id,
        runId: result.runId,
        workflowKey: template.workflowKey,
      };
    } catch (error) {
      await conn.rollback();
      if (claimed) {
        const attempts = Number(claimed.attempts ?? 0) + 1;
        const terminal = attempts >= MAX_ATTEMPTS;
        const reason = error instanceof Error ? error.message.slice(0, 1000) : 'Unknown dispatch error';
        await this.pool.query(
          `UPDATE ai_direct_outbox_events
           SET status = ?, attempts = ?, availableAt = TIMESTAMPADD(SECOND, ?, NOW()),
               failedAt = ?, failureReason = ?
           WHERE id = ? AND status = 'pending'`,
          [
            terminal ? 'failed' : 'pending',
            attempts,
            failureBackoffSeconds(attempts),
            terminal ? new Date() : null,
            reason,
            claimed.id,
          ],
        );
      }
      throw error;
    } finally {
      conn.release();
    }
  }
}

export async function dispatchAvailableOutboxEvents(
  pool: Pool,
  limit = 50,
): Promise<{ processed: number; enqueued: number; ignored: number }> {
  const dispatcher = new OutboxDispatcher(pool);
  let processed = 0;
  let enqueued = 0;
  let ignored = 0;
  while (processed < limit) {
    const result = await dispatcher.dispatchNext();
    if (result.kind === 'idle') break;
    processed += 1;
    if (result.kind === 'enqueued') enqueued += 1;
    if (result.kind === 'ignored') ignored += 1;
  }
  return { processed, enqueued, ignored };
}