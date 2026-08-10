import type { Pool } from "mysql2/promise";

export type InterviewRetentionCleanupResult = {
  deletedMessages: number;
  deletedAttachments: number;
};

/** Deletes only expired records without active message- or conversation-level holds. */
export async function cleanExpiredInterviewData(
  pool: Pool,
  limit = 20,
): Promise<InterviewRetentionCleanupResult> {
  const batchSize = Math.max(1, Math.min(limit, 20));
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [attachmentRows] = await conn.query(
      `SELECT a.id FROM ai_direct_interview_attachments a
       JOIN ai_direct_interview_messages m ON m.id = a.messageId
       JOIN ai_direct_interview_conversations c ON c.id = m.conversationId
       WHERE (a.deletedAt IS NOT NULL OR m.deletedAt IS NOT NULL OR a.retentionExpiresAt <= NOW(3))
         AND NOT EXISTS (
           SELECT 1 FROM ai_direct_interview_legal_holds h
           WHERE h.status = 'active' AND (h.messageId = m.id OR h.conversationId = c.id)
         )
       ORDER BY a.retentionExpiresAt ASC LIMIT ?`,
      [batchSize],
    );
    const attachmentIds = (attachmentRows as Array<{ id: string }>).map((row) => row.id);
    const attachmentDelete = attachmentIds.length
      ? await conn.query(
          `DELETE FROM ai_direct_interview_attachments WHERE id IN (${attachmentIds.map(() => "?").join(", ")})`,
          attachmentIds,
        )
      : [{ affectedRows: 0 }];
    const [messageRows] = await conn.query(
      `SELECT m.id FROM ai_direct_interview_messages m
       JOIN ai_direct_interview_conversations c ON c.id = m.conversationId
       WHERE (m.deletedAt IS NOT NULL OR m.retentionExpiresAt <= NOW(3))
         AND NOT EXISTS (
           SELECT 1 FROM ai_direct_interview_legal_holds h
           WHERE h.status = 'active' AND (h.messageId = m.id OR h.conversationId = c.id)
         )
       ORDER BY COALESCE(m.deletedAt, m.retentionExpiresAt) ASC LIMIT ?`,
      [batchSize],
    );
    const messageIds = (messageRows as Array<{ id: string }>).map((row) => row.id);
    const messageDelete = messageIds.length
      ? await conn.query(
          `DELETE FROM ai_direct_interview_messages WHERE id IN (${messageIds.map(() => "?").join(", ")})`,
          messageIds,
        )
      : [{ affectedRows: 0 }];
    const [attachmentResult] = attachmentDelete;
    const [messageResult] = messageDelete;
    await conn.commit();
    return {
      deletedAttachments: Number((attachmentResult as { affectedRows?: number }).affectedRows ?? 0),
      deletedMessages: Number((messageResult as { affectedRows?: number }).affectedRows ?? 0),
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
