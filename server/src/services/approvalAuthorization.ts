import type { PoolConnection } from "mysql2/promise";
import { AiDirectHiringError, ErrorCodes } from "./aiDirectErrors.js";
import type { ApprovalRow } from "./approvalRecord.js";

export type ApprovalAction = "approve" | "reject" | "cancel" | "delegate";

type OrganizationMember = {
  role: string;
  status: string;
};

async function lockOrganizationMember(
  connection: Pick<PoolConnection, "query">,
  organizationId: string,
  userId: string,
): Promise<OrganizationMember | null> {
  const [rows] = await connection.query(
    `SELECT role, status
     FROM ai_direct_organization_members
     WHERE organizationId = ? AND userId = ?
     LIMIT 1
     FOR SHARE`,
    [organizationId, userId],
  );
  const member = (rows as OrganizationMember[])[0];
  return member?.status === "active" ? member : null;
}

async function requireOrganizationAdmin(
  connection: Pick<PoolConnection, "query">,
  approval: ApprovalRow,
  actorUserId: string,
): Promise<void> {
  if (!approval.organizationId) {
    throw new AiDirectHiringError(
      ErrorCodes.FORBIDDEN_SCOPE,
      "平台级审批必须由指定审批人处理",
      403,
    );
  }
  const member = await lockOrganizationMember(connection, approval.organizationId, actorUserId);
  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, "用户的组织角色权限不足", 403);
  }
}

export async function authorizeApprovalAction(
  connection: Pick<PoolConnection, "query">,
  approval: ApprovalRow,
  action: ApprovalAction,
  actorUserId: string,
): Promise<void> {
  if (action === "cancel") {
    if (approval.requestedByUserId !== actorUserId && approval.approverUserId !== actorUserId) {
      throw new AiDirectHiringError(
        ErrorCodes.FORBIDDEN_SCOPE,
        "只有请求者或当前审批人可以取消此请求",
        403,
      );
    }
    return;
  }

  if (action !== "delegate" && approval.approverUserId === actorUserId) return;
  await requireOrganizationAdmin(connection, approval, actorUserId);
}

export async function requireActiveDelegationTarget(
  connection: Pick<PoolConnection, "query">,
  organizationId: string,
  toUserId: string,
): Promise<void> {
  const member = await lockOrganizationMember(connection, organizationId, toUserId);
  if (!member) {
    throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, "受委派人不是该组织的活跃成员", 403);
  }
}
