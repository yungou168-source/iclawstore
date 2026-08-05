import { createHash } from 'node:crypto';

export interface WorkforceEmployeeDigestInput {
  employmentId: string;
  organizationId: string;
  companyId: string;
  departmentId: string;
  positionId: string;
  roleId: string;
  agentId: string;
  agentVersionId: string;
  agentDisplayName: string;
  avatarAssetId: string | null;
  departmentName: string;
  positionName: string;
  roleName: string;
  employmentStatus: string;
  startedAt: Date | null;
}

export interface WorkforceEmployeeDigest extends WorkforceEmployeeDigestInput {
  revision: string;
}

const canonical = (value: WorkforceEmployeeDigestInput): string => JSON.stringify({
  ...value,
  startedAt: value.startedAt?.toISOString() ?? null,
});

/** Produces a stable value revision so unchanged projections need not be rewritten. */
export const buildWorkforceEmployeeDigest = (
  value: WorkforceEmployeeDigestInput,
): WorkforceEmployeeDigest => ({
  ...value,
  revision: createHash('sha256').update(canonical(value)).digest('hex'),
});