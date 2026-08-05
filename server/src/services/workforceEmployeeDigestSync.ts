import { AiDirectHiringError, ErrorCodes } from './aiDirectErrors.js';
import { countsTowardHeadcount } from './workforceStateMachine.js';
import { buildWorkforceEmployeeDigest, type WorkforceEmployeeDigestInput } from './workforceEmployeeDigest.js';

type QueryConnection = { query(sql: string, values?: unknown[]): Promise<any> };

interface DigestSourceRow extends WorkforceEmployeeDigestInput {}

/**
 * Keeps the directory projection in the caller's Employment transaction.
 * Missing structural links are domain-integrity failures: publishing a partial
 * employee record would make the desktop roster misleading.
 */
export async function synchronizeWorkforceEmployeeDigest(
  conn: QueryConnection,
  employmentId: string,
): Promise<void> {
  const [rows] = await conn.query(
    `SELECT e.id AS employmentId, c.organizationId, e.companyId,
            d.id AS departmentId, p.id AS positionId, e.roleId, e.agentId, e.agentVersionId,
            a.name AS agentDisplayName, profile.avatarAssetId,
            d.name AS departmentName, p.name AS positionName, r.name AS roleName,
            e.status AS employmentStatus, e.startedAt
     FROM ai_direct_employments e
     JOIN ai_direct_companies c ON c.id = e.companyId
     JOIN ai_direct_agent_roles r ON r.id = e.roleId AND r.companyId = e.companyId
     JOIN ai_direct_position_agent_roles pr ON pr.roleId = e.roleId
     JOIN ai_direct_positions p ON p.id = pr.positionId
     JOIN ai_direct_departments d ON d.id = p.departmentId AND d.companyId = e.companyId
     JOIN ai_direct_agents a ON a.id = e.agentId
     LEFT JOIN ai_direct_agent_appearance_profiles profile ON profile.agentId = e.agentId
     WHERE e.id = ?
     LIMIT 1`,
    [employmentId],
  );
  const row = (rows as DigestSourceRow[])[0];
  if (!row) {
    throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, 'Employment 员工目录投影缺少必要关联', 409);
  }

  if (!countsTowardHeadcount(row.employmentStatus)) {
    await conn.query(
      'DELETE FROM ai_direct_workforce_employee_digests WHERE employmentId = ?',
      [employmentId],
    );
    return;
  }

  const digest = buildWorkforceEmployeeDigest(row);
  await conn.query(
    `INSERT INTO ai_direct_workforce_employee_digests
       (employmentId, organizationId, companyId, departmentId, positionId, roleId, agentId,
        agentVersionId, agentDisplayName, avatarAssetId, departmentName, positionName, roleName,
        employmentStatus, startedAt, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       organizationId = IF(revision <> VALUES(revision), VALUES(organizationId), organizationId),
       companyId = IF(revision <> VALUES(revision), VALUES(companyId), companyId),
       departmentId = IF(revision <> VALUES(revision), VALUES(departmentId), departmentId),
       positionId = IF(revision <> VALUES(revision), VALUES(positionId), positionId),
       roleId = IF(revision <> VALUES(revision), VALUES(roleId), roleId),
       agentId = IF(revision <> VALUES(revision), VALUES(agentId), agentId),
       agentVersionId = IF(revision <> VALUES(revision), VALUES(agentVersionId), agentVersionId),
       agentDisplayName = IF(revision <> VALUES(revision), VALUES(agentDisplayName), agentDisplayName),
       avatarAssetId = IF(revision <> VALUES(revision), VALUES(avatarAssetId), avatarAssetId),
       departmentName = IF(revision <> VALUES(revision), VALUES(departmentName), departmentName),
       positionName = IF(revision <> VALUES(revision), VALUES(positionName), positionName),
       roleName = IF(revision <> VALUES(revision), VALUES(roleName), roleName),
       employmentStatus = IF(revision <> VALUES(revision), VALUES(employmentStatus), employmentStatus),
       startedAt = IF(revision <> VALUES(revision), VALUES(startedAt), startedAt),
       revision = IF(revision <> VALUES(revision), VALUES(revision), revision),
       updatedAt = IF(revision <> VALUES(revision), NOW(3), updatedAt)`,
    [
      digest.employmentId, digest.organizationId, digest.companyId, digest.departmentId,
      digest.positionId, digest.roleId, digest.agentId, digest.agentVersionId,
      digest.agentDisplayName, digest.avatarAssetId, digest.departmentName, digest.positionName,
      digest.roleName, digest.employmentStatus, digest.startedAt, digest.revision,
    ],
  );
}