import { createHash, randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
type ModerationRow = RowDataPacket & { id: string };

export type ModerationRole = 'subject_owner' | 'reporter' | 'moderator' | 'admin';
export const moderationPermissions = Object.freeze({
  report: ['reporter', 'subject_owner', 'moderator', 'admin'],
  review: ['moderator', 'admin'],
  appeal: ['subject_owner', 'reporter', 'moderator', 'admin'],
  resolve: ['moderator', 'admin'],
} as const);

export const canModerate = (action: keyof typeof moderationPermissions, role: ModerationRole): boolean => (moderationPermissions[action] as readonly string[]).includes(role);

export const createModerationFactsRepository = (pool: Pool) => ({
  async recordReport(input: Readonly<{ subjectType: string; subjectLegacyId: string; reporterLegacyId: string; caseType: string; reason: string; sourceHash: string; batchId: string }>): Promise<string> {
    const id = randomUUID();
    await pool.query('INSERT INTO migration_moderation_cases (id, subjectType, subjectLegacyId, reporterLegacyId, caseType, reason, sourceHash, batchId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(3)) ON DUPLICATE KEY UPDATE reason=VALUES(reason), sourceHash=VALUES(sourceHash), batchId=VALUES(batchId)', [id, input.subjectType, input.subjectLegacyId, input.reporterLegacyId, input.caseType, input.reason, input.sourceHash, input.batchId]);
    const [rows] = await pool.query<ModerationRow[]>('SELECT id FROM migration_moderation_cases WHERE subjectType=? AND subjectLegacyId=? AND reporterLegacyId=? AND caseType=?', [input.subjectType, input.subjectLegacyId, input.reporterLegacyId, input.caseType]);
    return rows[0].id;
  },
  async appendAudit(input: Readonly<{ action: string; subjectType: string; subjectId: string; actorId: string | null; payload: unknown; requestId?: string }>): Promise<void> {
    const payload = JSON.stringify(input.payload); const eventHash = createHash('sha256').update([input.action, input.subjectType, input.subjectId, input.actorId ?? '', payload].join('|')).digest('hex');
    await pool.query('INSERT IGNORE INTO migration_audit_events (id, domainName, action, subjectType, subjectId, actorId, requestId, payload, eventHash, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))', [randomUUID(), 'moderation', input.action, input.subjectType, input.subjectId, input.actorId, input.requestId ?? null, payload, eventHash]);
  },
});