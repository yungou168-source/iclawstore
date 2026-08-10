import type { PoolConnection } from "mysql2/promise";
import { AiDirectHiringError, ErrorCodes } from "./aiDirectErrors.js";
import type { ApprovalStatus } from "./approvalStateMachine.js";

export type ApprovalRow = {
  id: string;
  organizationId: string | null;
  targetType: string;
  targetId: string;
  requestedByUserId: string;
  approverUserId: string | null;
  status: ApprovalStatus;
  expiresAt: Date | null;
  isDue: number | boolean;
  [key: string]: unknown;
};

export async function lockApproval(
  connection: Pick<PoolConnection, "query">,
  approvalId: string,
): Promise<ApprovalRow> {
  const [rows] = await connection.query(
    `SELECT *, expiresAt IS NOT NULL AND expiresAt <= NOW(3) AS isDue
     FROM ai_direct_approvals
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`,
    [approvalId],
  );
  const approval = (rows as ApprovalRow[])[0];
  if (!approval) {
    throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "Approval 不存在", 404);
  }
  return approval;
}
