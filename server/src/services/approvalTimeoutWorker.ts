import type { Pool } from "mysql2/promise";
import { AiDirectHiringError, ErrorCodes } from "./aiDirectErrors.js";
import { decideApproval } from "./approvalDecision.js";

export async function expireDueApprovals(pool: Pool, limit = 20): Promise<number> {
  const [rows] = await pool.query(
    `SELECT id
     FROM ai_direct_approvals
     WHERE status = 'pending' AND expiresAt IS NOT NULL AND expiresAt <= NOW(3)
     ORDER BY expiresAt ASC, id ASC
     LIMIT ?`,
    [limit],
  );

  let expired = 0;
  for (const approval of rows as Array<{ id: string }>) {
    try {
      await decideApproval(pool, {
        approvalId: approval.id,
        decision: "expired",
        actorUserId: null,
        requestId: `approval-timeout:${approval.id}`,
        reason: "deadline_reached",
      });
      expired += 1;
    } catch (error) {
      // A manual decision or deadline change may win after the candidate scan.
      const details =
        error instanceof AiDirectHiringError && error.details && typeof error.details === "object"
          ? (error.details as Record<string, unknown>)
          : null;
      if (
        error instanceof AiDirectHiringError &&
        error.code === ErrorCodes.INVALID_TRANSITION &&
        details &&
        !("offerId" in details) &&
        !("hiringIntentId" in details)
      ) {
        continue;
      }
      throw error;
    }
  }
  return expired;
}
