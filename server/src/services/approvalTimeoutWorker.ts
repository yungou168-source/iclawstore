import { randomUUID } from 'node:crypto';
import type { Pool } from 'mysql2/promise';
import { publishOutboxEvent } from '../utils/outbox.js';
import { appendApprovalEvent } from './approvalEvents.js';

export async function expireDueApprovals(pool: Pool, limit = 20): Promise<number> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT id, organizationId, targetType, targetId
       FROM ai_direct_approvals
       WHERE status = 'pending' AND expiresAt IS NOT NULL AND expiresAt <= NOW(3)
       ORDER BY expiresAt ASC, id ASC LIMIT ? FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    let expired = 0;
    for (const approval of rows as Array<{ id: string; organizationId: string | null; targetType: string; targetId: string }>) {
      const [result] = await conn.query(
        `UPDATE ai_direct_approvals SET status = 'expired', decision = 'expired', decidedAt = NOW(3), updatedAt = NOW(3)
         WHERE id = ? AND status = 'pending'`, [approval.id],
      );
      if ((result as { affectedRows?: number }).affectedRows !== 1) continue;
      const requestId = `approval-timeout:${approval.id}`;
      await appendApprovalEvent(conn, {
        approvalId: approval.id,
        organizationId: approval.organizationId,
        eventType: 'approval.expired',
        actorUserId: null,
        requestId,
        metadata: { targetType: approval.targetType, targetId: approval.targetId, reason: 'deadline_reached' },
      });
      await conn.query(
        `INSERT INTO ai_direct_audit_events
         (id, organizationId, actorUserId, action, targetType, targetId, requestId, outcome, metadata)
         VALUES (?, ?, NULL, 'approval.expired', 'approval', ?, ?, 'success', ?)`,
        [randomUUID(), approval.organizationId, approval.id, requestId, JSON.stringify({ targetType: approval.targetType, targetId: approval.targetId, reason: 'deadline_reached' })],
      );
      await publishOutboxEvent(conn as any, {
        organizationId: approval.organizationId,
        aggregateType: 'approval',
        aggregateId: approval.id,
        eventType: 'approval.expired.v1',
        payload: { approvalId: approval.id, targetType: approval.targetType, targetId: approval.targetId, reason: 'deadline_reached' },
      });
      expired += 1;
    }
    await conn.commit();
    return expired;
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}