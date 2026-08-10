import type { RowDataPacket } from "mysql2/promise";
import { AiDirectHiringError, ErrorCodes } from "./aiDirectErrors.js";

export interface AppearanceQueryExecutor {
  query<T extends RowDataPacket[] = RowDataPacket[]>(
    sql: string,
    values?: unknown[],
  ): Promise<[T, unknown]>;
}

export interface AgentAppearanceScope extends RowDataPacket {
  agentId: string;
  ownerUserId: string;
  ownerPublisherId: string | null;
  avatarAssetId: string | null;
  defaultMode: "image_2d" | "model_3d";
  controllerEmploymentId: string | null;
  controllerCompanyId: string | null;
  revision: string | number | bigint | null;
  updatedAt: Date | null;
}

export interface AppearanceWriteAccess {
  scope: AgentAppearanceScope;
  authority: "developer" | "publisher" | "company";
}

export async function loadAgentAppearanceScope(
  executor: AppearanceQueryExecutor,
  agentId: string,
  lock = false,
): Promise<AgentAppearanceScope> {
  const [rows] = await executor.query<AgentAppearanceScope[]>(
    `SELECT agent.id AS agentId, agent.ownerUserId, agent.ownerPublisherId,
            profile.avatarAssetId, COALESCE(profile.defaultMode, 'image_2d') AS defaultMode,
            profile.controllerEmploymentId, profile.controllerCompanyId,
            profile.revision, profile.updatedAt
     FROM ai_direct_agents agent
     LEFT JOIN ai_direct_agent_appearance_profiles profile ON profile.agentId = agent.id
     WHERE agent.id = ?
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [agentId],
  );
  if (!rows[0]) {
    throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "Agent 不存在", 404);
  }
  return rows[0];
}

export async function requireAppearanceWriteAccess(
  executor: AppearanceQueryExecutor,
  scope: AgentAppearanceScope,
  userId: string,
): Promise<AppearanceWriteAccess> {
  if (scope.controllerCompanyId) {
    const [rows] = await executor.query<RowDataPacket[]>(
      `SELECT COALESCE(companyMember.role, organizationMember.role) AS companyRole
       FROM ai_direct_companies company
       JOIN ai_direct_organization_members organizationMember
         ON organizationMember.organizationId = company.organizationId
        AND organizationMember.userId = ?
        AND organizationMember.status = 'active'
       LEFT JOIN ai_direct_company_members companyMember
         ON companyMember.companyId = company.id
        AND companyMember.userId = organizationMember.userId
        AND companyMember.status = 'active'
       WHERE company.id = ?
       LIMIT 1`,
      [userId, scope.controllerCompanyId],
    );
    const role = rows[0]?.companyRole;
    if (role === "owner" || role === "admin" || role === "manager") {
      return { scope, authority: "company" };
    }
    throw new AiDirectHiringError(
      ErrorCodes.FORBIDDEN_SCOPE,
      "Agent 任职期间仅控制公司的 owner、admin 或 manager 可修改形象",
      403,
      { readOnlyReason: "controlled_by_employer", controllerCompanyId: scope.controllerCompanyId },
    );
  }

  if (scope.ownerUserId === userId) {
    return { scope, authority: "developer" };
  }
  if (scope.ownerPublisherId) {
    const [rows] = await executor.query<RowDataPacket[]>(
      `SELECT publisher.id
       FROM publishers publisher
       LEFT JOIN publisherMembers member
         ON member.publisherId = publisher.id AND member.userId = ?
       WHERE publisher.id = ? AND publisher.deletedAt IS NULL
         AND (publisher.linkedUserId = ? OR member.id IS NOT NULL)
       LIMIT 1`,
      [userId, scope.ownerPublisherId, userId],
    );
    if (rows[0]) {
      return { scope, authority: "publisher" };
    }
  }
  throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, "用户无权修改该 Agent 形象", 403, {
    readOnlyReason: "not_agent_owner",
  });
}

export async function canWriteAppearance(
  executor: AppearanceQueryExecutor,
  scope: AgentAppearanceScope,
  userId: string,
): Promise<{
  canWrite: boolean;
  authority: AppearanceWriteAccess["authority"] | null;
  readOnlyReason: string | null;
}> {
  try {
    const access = await requireAppearanceWriteAccess(executor, scope, userId);
    return { canWrite: true, authority: access.authority, readOnlyReason: null };
  } catch (error) {
    if (error instanceof AiDirectHiringError && error.code === ErrorCodes.FORBIDDEN_SCOPE) {
      const details = error.details as { readOnlyReason?: string } | undefined;
      return {
        canWrite: false,
        authority: null,
        readOnlyReason: details?.readOnlyReason ?? "forbidden",
      };
    }
    throw error;
  }
}

export function appearanceEtag(revision: string | number | bigint | null): string {
  return `\"appearance-${revision === null ? "0" : String(revision)}\"`;
}

export function parseAppearanceIfMatch(value: unknown): bigint {
  if (typeof value !== "string") {
    throw new AiDirectHiringError(
      ErrorCodes.PRECONDITION_REQUIRED,
      '必须提交 If-Match: \"appearance-{revision}\"',
      428,
    );
  }
  const match = /^\"?appearance-(0|[1-9][0-9]*)\"?$/.exec(value.trim());
  if (!match) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "If-Match 格式无效");
  }
  return BigInt(match[1]!);
}

export function assertAppearanceRevision(
  expected: bigint,
  current: string | number | bigint | null,
): void {
  const revision = BigInt(current ?? 0);
  if (expected !== revision) {
    throw new AiDirectHiringError(
      ErrorCodes.REVISION_CONFLICT,
      "Agent 形象已被其他客户端更新",
      409,
      { currentRevision: revision.toString(), etag: appearanceEtag(revision) },
    );
  }
}
