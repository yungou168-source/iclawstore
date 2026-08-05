/**
 * AI Direct Hiring — Company & Employment RBAC middleware.
 *
 * Design assumptions (per ai-direct-hiring.md):
 * - Organization-level roles: owner > admin > manager > member
 *   (from server/src/services/organizationRbac.ts)
 * - Company inherits org membership; company-level rank is:
 *   owner > admin > manager > recruiter
 * - minRole: the minimum rank required to proceed.
 *
 * Employment scope: only org members with rank >= recruiter can
 * touch employments under the same company.
 */

import { Pool } from 'mysql2/promise';
import { AiDirectHiringError, ErrorCodes } from '../services/aiDirectErrors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const companyRoles = ['owner', 'admin', 'manager', 'recruiter'] as const;
export type CompanyRole = (typeof companyRoles)[number];

export const companyRoleRank: Record<CompanyRole, number> = {
  owner: 4,
  admin: 3,
  manager: 2,
  recruiter: 1,
};

export type OrgRole = 'owner' | 'admin' | 'manager' | 'member';

export const orgRoleRank: Record<OrgRole, number> = {
  owner: 4,
  admin: 3,
  manager: 2,
  member: 1,
};

export interface CompanyMemberRow {
  companyId: string;
  orgRole: OrgRole;
  companyRole: CompanyRole;
  status: string;
}

export interface EmploymentRow {
  id: string;
  companyId: string;
  requestedByUserId: string | null;
  agentId: string;
  agentVersionId: string;
  roleId: string;
  projectId: string | null;
  offerId: string;
  status: string;
  startedAt: Date | null;
  endedAt: Date | null;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class RbacError extends AiDirectHiringError {
  constructor(code: typeof ErrorCodes.FORBIDDEN_SCOPE | typeof ErrorCodes.NOT_FOUND, message: string) {
    super(code, message, code === ErrorCodes.NOT_FOUND ? 404 : 403);
    this.name = 'RbacError';
  }
}

// ---------------------------------------------------------------------------
// Company role helpers
// ---------------------------------------------------------------------------

export function parseCompanyRole(value: unknown): CompanyRole | null {
  return typeof value === 'string' && companyRoles.includes(value as CompanyRole)
    ? (value as CompanyRole)
    : null;
}

export function canManageCompany(role: CompanyRole): boolean {
  return role === 'owner' || role === 'admin';
}

export function canManageEmploymentScope(role: CompanyRole): boolean {
  return companyRoleRank[role] >= companyRoleRank.recruiter;
}

// ---------------------------------------------------------------------------
// Company membership lookup
// ---------------------------------------------------------------------------

async function lookupCompanyMembership(
  pool: Pool,
  companyId: string,
  userId: string,
): Promise<CompanyMemberRow | null> {
  const [rows] = await pool.query(
    `SELECT c.organizationId, m.role AS orgRole,
            COALESCE(cm.role, m.role) AS companyRole,
            COALESCE(cm.status, m.status) AS status
     FROM ai_direct_companies c
     JOIN ai_direct_organization_members m ON m.organizationId = c.organizationId
     LEFT JOIN ai_direct_company_members cm ON cm.companyId = c.id AND cm.userId = m.userId
     WHERE c.id = ? AND m.userId = ? AND m.status = 'active'
     LIMIT 1`,
    [companyId, userId],
  );
  const row = (rows as CompanyMemberRow[])[0];
  return row?.status === 'active' ? row : null;
}

// ---------------------------------------------------------------------------
// requireCompanyRole — primary gate
// ---------------------------------------------------------------------------

/**
 * Check that the requesting user is an active org member with at least `minRole`
 * rank under the given company. Use for any company-scoped write operation.
 *
 * @param pool       MySQL pool from fastify.mysql
 * @param companyId  Target company id (NOT organizationId — resolved internally)
 * @param userId     Authenticated user id
 * @param minRole    Minimum company role required (inclusive)
 */
export async function requireCompanyRole(
  pool: Pool,
  companyId: string,
  userId: string,
  minRole: CompanyRole,
): Promise<CompanyMemberRow> {
  const member = await lookupCompanyMembership(pool, companyId, userId);
  if (!member) {
    throw new RbacError(ErrorCodes.FORBIDDEN_SCOPE, '用户不是该公司的成员');
  }
  const requiredRank = companyRoleRank[minRole];
  const userRank = companyRoleRank[member.companyRole] ?? 0;
  if (userRank < requiredRank) {
    throw new RbacError(ErrorCodes.FORBIDDEN_SCOPE, '用户的公司角色权限不足');
  }
  return member;
}

// ---------------------------------------------------------------------------
// requireEmploymentScope — employment-scoped gate
// ---------------------------------------------------------------------------

/**
 * Check that the requesting user can act on a given employment.
 * Allowed if:
 *   (a) user is the original requester, OR
 *   (b) user is an org member with company role >= recruiter
 *
 * @param pool          MySQL pool
 * @param employmentId  Target employment id
 * @param userId        Authenticated user id
 */
export async function requireEmploymentScope(
  pool: Pool,
  employmentId: string,
  userId: string,
): Promise<EmploymentRow> {
  const [rows] = await pool.query(
    `SELECT id, companyId, requestedByUserId, agentId, agentVersionId, roleId,
            projectId, offerId, status, startedAt, endedAt
     FROM ai_direct_employments WHERE id = ? LIMIT 1`,
    [employmentId],
  );
  const employment = (rows as EmploymentRow[])[0];
  if (!employment) {
    throw new RbacError(ErrorCodes.NOT_FOUND, 'Employment 不存在');
  }

  // Self: the requester is always allowed to see / act on their own employment
  if (employment.requestedByUserId === userId) {
    return employment;
  }

  // Org scope: check org membership with recruiter rank
  const member = await lookupCompanyMembership(pool, employment.companyId, userId);
  if (!member || !canManageEmploymentScope(member.companyRole)) {
    throw new RbacError(ErrorCodes.FORBIDDEN_SCOPE, '用户无权操作该 Employment');
  }
  return employment;
}

// ---------------------------------------------------------------------------
// orgMemberAccess — lightweight org membership check (for routes that only
// need org-level verification without company involvement)
// ---------------------------------------------------------------------------

export interface OrgMemberRow {
  organizationId: string;
  role: OrgRole;
  status: string;
}

export async function orgMemberAccess(
  pool: Pool,
  organizationId: string,
  userId: string,
): Promise<OrgMemberRow | null> {
  const [rows] = await pool.query(
    `SELECT organizationId, role, status FROM ai_direct_organization_members
     WHERE organizationId = ? AND userId = ? LIMIT 1`,
    [organizationId, userId],
  );
  const row = (rows as OrgMemberRow[])[0];
  return row?.status === 'active' ? row : null;
}

export async function requireOrganizationRole(
  pool: Pool,
  organizationId: string,
  userId: string,
  minRole: OrgRole,
): Promise<OrgMemberRow> {
  const member = await orgMemberAccess(pool, organizationId, userId);
  if (!member) {
    throw new RbacError(ErrorCodes.FORBIDDEN_SCOPE, '用户不是该组织的成员');
  }
  if ((orgRoleRank[member.role] ?? 0) < orgRoleRank[minRole]) {
    throw new RbacError(ErrorCodes.FORBIDDEN_SCOPE, '用户的组织角色权限不足');
  }
  return member;
}
