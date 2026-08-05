import type { FastifyInstance } from 'fastify';
import type { Pool } from 'mysql2/promise';
import { requireAuth } from '../middleware/aiDirectAuth.js';
import { requireCompanyRole } from '../middleware/aiDirectRbac.js';
import { AiDirectHiringError, ErrorCodes, errorResponse } from '../services/aiDirectErrors.js';
import { rankCandidateMatches, requiredCapabilitiesFrom } from '../services/candidateMatching.js';
import { featureFlagsForOrganization } from './aiDirectSession.js';

type Database = Pool;

type PositionRow = {
  id: string;
  companyId: string;
  organizationId: string;
  status: string;
  requirementsSummary: unknown;
};

type RoleRow = { requiredCapabilities: unknown };

type CandidateRow = {
  agentId: string;
  displayName: string;
  availability: string;
  capabilitySummary: unknown;
  isEmployed: number;
};

type MatchCursor = { score: number; displayName: string; agentId: string };

const asRows = <T>(value: unknown): T[] => value as T[];

const parseLimit = (value: unknown): number => {
  const limit = typeof value === 'string' ? Number(value) : Number(value ?? 20);
  return Number.isInteger(limit) && limit >= 1 && limit <= 50 ? limit : 20;
};

const decodeCursor = (value: unknown): MatchCursor | null => {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'cursor 无效');
  }
  try {
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (typeof cursor?.score !== 'number' || typeof cursor?.displayName !== 'string' || typeof cursor?.agentId !== 'string') {
      throw new Error('invalid cursor');
    }
    return cursor;
  } catch {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'cursor 无效');
  }
};

const encodeCursor = (item: { score: number; displayName: string; agentId: string }): string =>
  Buffer.from(JSON.stringify({ score: item.score, displayName: item.displayName, agentId: item.agentId })).toString('base64url');

const afterCursor = (item: { score: number; displayName: string; agentId: string }, cursor: MatchCursor): boolean =>
  item.score < cursor.score
  || (item.score === cursor.score && item.displayName.localeCompare(cursor.displayName, 'zh-CN') > 0)
  || (item.score === cursor.score && item.displayName === cursor.displayName && item.agentId > cursor.agentId);

export async function aiDirectCandidateMatchingRoutes(fastify: FastifyInstance): Promise<void> {
  const pool = (fastify as unknown as { mysql: Database }).mysql;

  fastify.get('/workforce/positions/:id/candidate-matches', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    try {
      const user = await requireAuth(fastify, request);
      const { id: positionId } = request.params as { id: string };
      const [positionResult] = await pool.query(
        `SELECT p.id, p.status, p.requirementsSummary, d.companyId, c.organizationId
         FROM ai_direct_positions p
         JOIN ai_direct_departments d ON d.id = p.departmentId
         JOIN ai_direct_companies c ON c.id = d.companyId
         WHERE p.id = ? LIMIT 1`,
        [positionId],
      );
      const position = asRows<PositionRow>(positionResult)[0];
      if (!position) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, 'Position 不存在', 404);
      await requireCompanyRole(pool, position.companyId, user.id, 'recruiter');
      if (featureFlagsForOrganization(position.organizationId).candidateCatalog !== true) {
        throw new AiDirectHiringError(ErrorCodes.RUNTIME_CAPABILITY_DISABLED, '候选目录尚未启用', 403);
      }
      if (position.status !== 'open') {
        throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, '仅 open Position 可以匹配候选人', 409);
      }

      const [roleResult] = await pool.query(
        `SELECT r.requiredCapabilities
         FROM ai_direct_position_agent_roles pr
         JOIN ai_direct_agent_roles r ON r.id = pr.roleId
         WHERE pr.positionId = ? AND r.status = 'open'
         ORDER BY r.id ASC`,
        [position.id],
      );
      const requiredCapabilities = [...new Set([
        ...requiredCapabilitiesFrom(position.requirementsSummary),
        ...asRows<RoleRow>(roleResult).flatMap((role) => requiredCapabilitiesFrom({ requiredCapabilities: role.requiredCapabilities })),
      ])].sort((left, right) => left.localeCompare(right, 'zh-CN'));

      const [candidateResult] = await pool.query(
        `SELECT d.agentId, d.displayName, d.availability, d.capabilitySummary,
                COALESCE(c.isEmployed, FALSE) AS isEmployed
         FROM ai_direct_candidate_catalog_digests d
         LEFT JOIN ai_direct_organization_candidate_catalog_counts c
           ON c.organizationId = ? AND c.agentId = d.agentId
         WHERE d.availability = 'available'
         ORDER BY d.displayName ASC, d.agentId ASC`,
        [position.organizationId],
      );
      const cursor = decodeCursor((request.query as { cursor?: string }).cursor);
      const limit = parseLimit((request.query as { limit?: string }).limit);
      const ranked = rankCandidateMatches(requiredCapabilities, asRows<CandidateRow>(candidateResult).map((candidate) => ({
        ...candidate,
        isEmployedByCurrentOrganization: Boolean(candidate.isEmployed),
      })));
      const remaining = cursor ? ranked.filter((item) => afterCursor(item, cursor)) : ranked;
      const items = remaining.slice(0, limit);
      const last = items.at(-1);
      return {
        scoringVersion: 'capability-coverage-v1',
        positionId: position.id,
        requiredCapabilities,
        items: items.map((item) => ({
          agentId: item.agentId,
          displayName: item.displayName,
          score: item.score,
          matchedCapabilities: item.matchedCapabilities,
          missingCapabilities: item.missingCapabilities,
          availability: item.availability,
          viewerDisclosure: { isEmployedByCurrentOrganization: item.isEmployedByCurrentOrganization },
        })),
        nextCursor: remaining.length > limit && last ? encodeCursor(last) : null,
      };
    } catch (error) {
      if (error instanceof AiDirectHiringError) return reply.status(error.httpStatus).send(errorResponse(error));
      throw error;
    }
  });
}