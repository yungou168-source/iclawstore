import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/aiDirectAuth.js';
import { requireOrganizationRole } from '../middleware/aiDirectRbac.js';
import { AiDirectHiringError, ErrorCodes } from '../services/aiDirectErrors.js';
import { featureFlagsForOrganization } from './aiDirectSession.js';
import {
  interviewRetentionDefaults,
  normalizeInterviewRetentionPolicy,
  retentionExpiresAt,
} from '../services/interviewRetentionPolicy.js';
import { publishOutboxEvent } from '../utils/outbox.js';

const readObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '请求体必须是对象');
  }
  return value as Record<string, unknown>;
};

const readString = (value: unknown, field: string, maxLength: number): string => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 长度必须为 1 到 ${maxLength}`);
  }
  return value.trim();
};

const rejectExtra = (body: Record<string, unknown>, allowed: string[]): void => {
  const extra = Object.keys(body).filter((key) => !allowed.includes(key));
  if (extra.length) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `不接受以下字段: ${extra.join(', ')}`);
};

const parseLimit = (value: unknown): number => {
  const limit = Number(value ?? 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'limit 必须为 1 到 100');
  }
  return limit;
};

async function writeAudit(conn: any, input: { organizationId: string; actorUserId: string; action: string; targetType: string; targetId: string; metadata?: Record<string, unknown> }) {
  await conn.query(
    `INSERT INTO ai_direct_audit_events
     (id, organizationId, actorUserId, action, targetType, targetId, outcome, metadata)
     VALUES (?, ?, ?, ?, ?, ?, 'success', ?)`,
    [randomUUID(), input.organizationId, input.actorUserId, input.action, input.targetType, input.targetId, input.metadata ? JSON.stringify(input.metadata) : null],
  );
}

const assertInterviewsEnabled = (organizationId: string): void => {
  if (!featureFlagsForOrganization(organizationId).interviews) {
    throw new AiDirectHiringError(ErrorCodes.RUNTIME_CAPABILITY_DISABLED, '远端面试能力未启用', 403);
  }
};

async function requireParticipant(pool: any, conversationId: string, userId: string) {
  const [rows] = await pool.query(
    `SELECT c.id, c.organizationId, p.modelUseOptedOutAt
     FROM ai_direct_interview_conversations c
     JOIN ai_direct_interview_participants p ON p.conversationId = c.id
     WHERE c.id = ? AND p.userId = ? AND p.status = 'active' AND c.status = 'active' LIMIT 1`,
    [conversationId, userId],
  );
  const participant = (rows as any[])[0];
  if (!participant) throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, '无权访问该面试会话', 403);
  assertInterviewsEnabled(participant.organizationId);
  return participant;
}

export async function aiDirectInterviewRoutes(fastify: FastifyInstance): Promise<void> {
  const pool = (fastify as any).mysql as any;
  const auth = [(fastify as any).authenticate];

  fastify.get('/interview-retention-policies/:organizationId', { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request);
    await requireOrganizationRole(pool, request.params.organizationId, user.id, 'member');
    const [rows] = await pool.query(
      `SELECT bodyRetentionDays, modelConsentMode, attachmentPolicy, attachmentMaxBytes, version, updatedAt
       FROM ai_direct_interview_retention_policies WHERE organizationId = ? LIMIT 1`,
      [request.params.organizationId],
    );
    return (rows as any[])[0] ?? { ...interviewRetentionDefaults, version: 1, source: 'default' };
  });

  fastify.put('/interview-retention-policies/:organizationId', { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request);
    const organizationId = readString(request.params.organizationId, 'organizationId', 36);
    await requireOrganizationRole(pool, organizationId, user.id, 'admin');
    const policy = normalizeInterviewRetentionPolicy(request.body);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `INSERT INTO ai_direct_interview_retention_policies
         (organizationId, bodyRetentionDays, modelConsentMode, attachmentPolicy, attachmentMaxBytes, version, updatedByUserId)
         VALUES (?, ?, ?, ?, ?, 1, ?)
         ON DUPLICATE KEY UPDATE version = version + 1, updatedByUserId = VALUES(updatedByUserId), updatedAt = NOW(3)`,
        [organizationId, policy.bodyRetentionDays, policy.modelConsentMode, policy.attachmentPolicy, policy.attachmentMaxBytes, user.id],
      );
      await writeAudit(conn, { organizationId, actorUserId: user.id, action: 'interview.retention_policy.updated', targetType: 'interview_retention_policy', targetId: organizationId, metadata: policy });
      await publishOutboxEvent(conn, { organizationId, aggregateType: 'interview_retention_policy', aggregateId: organizationId, eventType: 'interview.retention_policy.updated.v1', payload: policy });
      await conn.commit();
      return policy;
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  });

  fastify.post('/interviews', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const body = readObject(request.body); rejectExtra(body, ['organizationId', 'agentVersionId', 'participantUserIds']);
    const organizationId = readString(body.organizationId, 'organizationId', 36);
    const agentVersionId = readString(body.agentVersionId, 'agentVersionId', 36);
    const participantUserIds = Array.isArray(body.participantUserIds) ? body.participantUserIds.map((value) => readString(value, 'participantUserIds[]', 191)) : [];
    if (participantUserIds.length > 20) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '参与者最多 20 人');
    await requireOrganizationRole(pool, organizationId, user.id, 'member');
    assertInterviewsEnabled(organizationId);
    const conversationId = randomUUID();
    const participants = [...new Set([user.id, ...participantUserIds])];
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`INSERT INTO ai_direct_interview_conversations (id, organizationId, agentVersionId, createdByUserId, status) VALUES (?, ?, ?, ?, 'active')`, [conversationId, organizationId, agentVersionId, user.id]);
      for (const participantId of participants) {
        await conn.query(`INSERT INTO ai_direct_interview_participants (id, conversationId, userId, status) VALUES (?, ?, ?, 'active')`, [randomUUID(), conversationId, participantId]);
      }
      await writeAudit(conn, { organizationId, actorUserId: user.id, action: 'interview.created', targetType: 'interview_conversation', targetId: conversationId, metadata: { agentVersionId, participantCount: participants.length } });
      await publishOutboxEvent(conn, { organizationId, aggregateType: 'interview_conversation', aggregateId: conversationId, eventType: 'interview.created.v1', payload: { conversationId, agentVersionId } });
      await conn.commit(); return reply.status(201).send({ id: conversationId, organizationId, agentVersionId, latestSequence: 0 });
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  });

  fastify.post('/interview-legal-holds', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request); const body = readObject(request.body); rejectExtra(body, ['organizationId', 'conversationId', 'messageId', 'reason']);
    const organizationId = readString(body.organizationId, 'organizationId', 36); const reason = readString(body.reason, 'reason', 500);
    const conversationId = body.conversationId === undefined ? null : readString(body.conversationId, 'conversationId', 36);
    const messageId = body.messageId === undefined ? null : readString(body.messageId, 'messageId', 36);
    if (!conversationId && !messageId) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '必须指定 conversationId 或 messageId');
    await requireOrganizationRole(pool, organizationId, user.id, 'admin');
    if (conversationId) {
      const [rows] = await pool.query(`SELECT 1 FROM ai_direct_interview_conversations WHERE id = ? AND organizationId = ? LIMIT 1`, [conversationId, organizationId]);
      if (!(rows as any[]).length) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, '面试会话不存在', 404);
    }
    if (messageId) {
      const [rows] = await pool.query(`SELECT 1 FROM ai_direct_interview_messages m JOIN ai_direct_interview_conversations c ON c.id = m.conversationId WHERE m.id = ? AND c.organizationId = ? LIMIT 1`, [messageId, organizationId]);
      if (!(rows as any[]).length) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, '面试消息不存在', 404);
    }
    const holdId = randomUUID(); const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`INSERT INTO ai_direct_interview_legal_holds (id, organizationId, conversationId, messageId, reason, status, createdByUserId) VALUES (?, ?, ?, ?, ?, 'active', ?)`, [holdId, organizationId, conversationId, messageId, reason, user.id]);
      await writeAudit(conn, { organizationId, actorUserId: user.id, action: 'interview.legal_hold.created', targetType: 'interview_legal_hold', targetId: holdId, metadata: { conversationId, messageId } });
      await publishOutboxEvent(conn, { organizationId, aggregateType: 'interview_legal_hold', aggregateId: holdId, eventType: 'interview.legal_hold.created.v1', payload: { holdId, conversationId, messageId } });
      await conn.commit(); return reply.status(201).send({ id: holdId, status: 'active' });
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  });

  fastify.delete('/interview-legal-holds/:holdId', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request); const holdId = readString(request.params.holdId, 'holdId', 36);
    const [rows] = await pool.query(`SELECT organizationId, status FROM ai_direct_interview_legal_holds WHERE id = ? LIMIT 1`, [holdId]);
    const hold = (rows as any[])[0]; if (!hold) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, '法务保留不存在', 404);
    await requireOrganizationRole(pool, hold.organizationId, user.id, 'admin');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction(); await conn.query(`UPDATE ai_direct_interview_legal_holds SET status = 'released', releasedByUserId = ?, releasedAt = NOW(3) WHERE id = ? AND status = 'active'`, [user.id, holdId]);
      await writeAudit(conn, { organizationId: hold.organizationId, actorUserId: user.id, action: 'interview.legal_hold.released', targetType: 'interview_legal_hold', targetId: holdId });
      await publishOutboxEvent(conn, { organizationId: hold.organizationId, aggregateType: 'interview_legal_hold', aggregateId: holdId, eventType: 'interview.legal_hold.released.v1', payload: { holdId } });
      await conn.commit(); return reply.status(204).send();
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  });

  fastify.put('/interviews/:conversationId/model-consent', { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request); const conversationId = readString(request.params.conversationId, 'conversationId', 36);
    const participant = await requireParticipant(pool, conversationId, user.id); const body = readObject(request.body); rejectExtra(body, ['optedOut']);
    if (typeof body.optedOut !== 'boolean') throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'optedOut 必须是布尔值');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`UPDATE ai_direct_interview_participants SET modelUseOptedOutAt = ?, updatedAt = NOW(3) WHERE conversationId = ? AND userId = ?`, [body.optedOut ? new Date() : null, conversationId, user.id]);
      await writeAudit(conn, { organizationId: participant.organizationId, actorUserId: user.id, action: 'interview.model_consent.updated', targetType: 'interview_participant', targetId: `${conversationId}:${user.id}`, metadata: { optedOut: body.optedOut } });
      await publishOutboxEvent(conn, { organizationId: participant.organizationId, aggregateType: 'interview_participant', aggregateId: `${conversationId}:${user.id}`, eventType: 'interview.model_consent.updated.v1', payload: { conversationId, userId: user.id, optedOut: body.optedOut } });
      await conn.commit();
      return { conversationId, optedOut: body.optedOut };
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  });

  fastify.get('/interviews/:conversationId/messages', { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request); const conversationId = readString(request.params.conversationId, 'conversationId', 36);
    await requireParticipant(pool, conversationId, user.id);
    const afterSequence = request.query?.afterSequence === undefined ? 0 : Number(request.query.afterSequence);
    if (!Number.isInteger(afterSequence) || afterSequence < 0) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'afterSequence 无效');
    const limit = parseLimit(request.query?.limit);
    const [rows] = await pool.query(`SELECT id, sequence, senderUserId, body, createdAt, deletedAt FROM ai_direct_interview_messages WHERE conversationId = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?`, [conversationId, afterSequence, limit]);
    const items = (rows as any[]).map(({ body, deletedAt, ...message }) => ({ ...message, body: deletedAt ? null : body }));
    return { items, nextSequence: items.length === limit ? items[items.length - 1]?.sequence : null };
  });

  fastify.post('/interviews/:conversationId/messages', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request); const conversationId = readString(request.params.conversationId, 'conversationId', 36);
    const body = readObject(request.body); rejectExtra(body, ['body']); const text = readString(body.body, 'body', 10_000);
    const participant = await requireParticipant(pool, conversationId, user.id); const messageId = randomUUID(); const expiresAt = retentionExpiresAt();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [sequenceRows] = await conn.query(`SELECT latestSequence FROM ai_direct_interview_conversations WHERE id = ? LIMIT 1 FOR UPDATE`, [conversationId]);
      const sequence = Number((sequenceRows as any[])[0]?.latestSequence ?? -1) + 1;
      if (sequence < 1) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, '面试会话不存在', 404);
      await conn.query(`INSERT INTO ai_direct_interview_messages (id, conversationId, sequence, senderUserId, body, retentionExpiresAt) VALUES (?, ?, ?, ?, ?, ?)`, [messageId, conversationId, sequence, user.id, text, expiresAt]);
      await conn.query(`UPDATE ai_direct_interview_conversations SET latestSequence = ?, updatedAt = NOW(3) WHERE id = ?`, [sequence, conversationId]);
      await writeAudit(conn, { organizationId: participant.organizationId, actorUserId: user.id, action: 'interview.message.created', targetType: 'interview_message', targetId: messageId, metadata: { conversationId, sequence } });
      await publishOutboxEvent(conn, { organizationId: participant.organizationId, aggregateType: 'interview_message', aggregateId: messageId, eventType: 'interview.message.created.v1', payload: { conversationId, sequence } });
      await conn.commit(); return reply.status(201).send({ id: messageId, sequence, senderUserId: user.id, body: text, retentionExpiresAt: expiresAt.toISOString() });
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  });

  fastify.delete('/interviews/:conversationId/messages/:messageId', { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request); const conversationId = readString(request.params.conversationId, 'conversationId', 36);
    const messageId = readString(request.params.messageId, 'messageId', 36); const participant = await requireParticipant(pool, conversationId, user.id);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query(`SELECT senderUserId, deletedAt FROM ai_direct_interview_messages WHERE id = ? AND conversationId = ? LIMIT 1 FOR UPDATE`, [messageId, conversationId]);
      const message = (rows as any[])[0];
      if (!message) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, '面试消息不存在', 404);
      if (message.senderUserId !== user.id) throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, '仅发送者可以删除该消息', 403);
      if (!message.deletedAt) await conn.query(`UPDATE ai_direct_interview_messages SET deletedAt = NOW(3), deletedByUserId = ? WHERE id = ?`, [user.id, messageId]);
      await writeAudit(conn, { organizationId: participant.organizationId, actorUserId: user.id, action: 'interview.message.deleted', targetType: 'interview_message', targetId: messageId, metadata: { conversationId } });
      await publishOutboxEvent(conn, { organizationId: participant.organizationId, aggregateType: 'interview_message', aggregateId: messageId, eventType: 'interview.message.deletion_requested.v1', payload: { conversationId, messageId } });
      await conn.commit(); return reply.status(204).send();
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  });

  fastify.put('/interviews/:conversationId/read-cursor', { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request); const conversationId = readString(request.params.conversationId, 'conversationId', 36);
    await requireParticipant(pool, conversationId, user.id); const body = readObject(request.body); rejectExtra(body, ['sequence']);
    const sequence = Number(body.sequence); if (!Number.isInteger(sequence) || sequence < 0) throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'sequence 无效');
    await pool.query(`INSERT INTO ai_direct_interview_read_cursors (conversationId, userId, sequence) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE sequence = GREATEST(sequence, VALUES(sequence)), updatedAt = NOW(3)`, [conversationId, user.id, sequence]);
    return { conversationId, sequence };
  });
}