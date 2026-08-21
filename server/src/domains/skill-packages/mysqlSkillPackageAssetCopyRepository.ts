import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { SkillPackageAssetCopyQueue } from './skillPackageAssetCopyConsumer.js';
import type { ArtifactCopyRequest } from './skillPackageMigrationPort.js';

const EVENT_TYPE = 'skill-package.asset.copy-requested';
const MAX_ATTEMPTS = 8;
const MAX_BACKOFF_SECONDS = 300;
const LEASE_SECONDS = 120;

type OutboxRow = RowDataPacket & {
  id: string;
  aggregateId: string;
  payload: unknown;
  attempts: number | bigint | string;
};

type Claim = Readonly<{
  id: string;
  claimToken: string;
  request: ArtifactCopyRequest;
}>;

type QueryResult = Readonly<{ affectedRows?: number | bigint }>;

const affectedRows = (result: unknown): number => {
  if (!Array.isArray(result) || !result[0] || typeof result[0] !== 'object') return 0;
  return Number((result[0] as QueryResult).affectedRows ?? 0);
};

const parseRequest = (payload: unknown): ArtifactCopyRequest => {
  const value = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('skill_package_asset_copy_payload_invalid');
  const candidate = value as Record<string, unknown>;
  const artifact = candidate.artifact;
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) throw new Error('skill_package_asset_copy_payload_invalid');
  const file = artifact as Record<string, unknown>;
  if (
    (candidate.domain !== 'skill' && candidate.domain !== 'package') ||
    typeof candidate.versionLegacyConvexId !== 'string' || !candidate.versionLegacyConvexId ||
    (file.legacyStorageId !== null && typeof file.legacyStorageId !== 'string') ||
    typeof file.path !== 'string' || typeof file.mimeType !== 'string' ||
    typeof file.sizeBytes !== 'number' || typeof file.sha256 !== 'string'
  ) throw new Error('skill_package_asset_copy_payload_invalid');
  return {
    domain: candidate.domain,
    versionLegacyConvexId: candidate.versionLegacyConvexId,
    artifact: {
      legacyStorageId: file.legacyStorageId,
      path: file.path,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
    },
  };
};

const claimNext = async (connection: PoolConnection): Promise<Claim | null> => {
  await connection.beginTransaction();
  try {
    const [rows] = await connection.query<OutboxRow[]>(
      `SELECT id, aggregateId, payload, attempts FROM convex_exit_outbox_events
       WHERE eventType = ?
         AND ((status = 'pending' AND availableAt <= NOW(3))
           OR (status = 'processing' AND leaseExpiresAt <= NOW(3)))
       ORDER BY occurredAt ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [EVENT_TYPE],
    );
    const row = rows[0];
    if (!row) {
      await connection.rollback();
      return null;
    }
    const request = parseRequest(row.payload);
    const claimToken = randomUUID();
    const updated = affectedRows(await connection.query(
      `UPDATE convex_exit_outbox_events event
       INNER JOIN skill_package_version_snapshots version ON version.id = event.aggregateId
       INNER JOIN skill_package_artifact_snapshots artifact ON artifact.versionSnapshotId = version.id
       SET event.status = 'processing', event.claimedAt = NOW(3), event.claimToken = ?,
           event.leaseExpiresAt = TIMESTAMPADD(SECOND, ?, NOW(3)), event.failureReason = NULL,
           artifact.copyStatus = 'copying', artifact.claimToken = ?,
           artifact.claimExpiresAt = TIMESTAMPADD(SECOND, ?, NOW(3)), artifact.failureCode = NULL
       WHERE event.id = ?
         AND artifact.legacyStorageId <=> ? AND artifact.path = ? AND artifact.mimeType = ?
         AND artifact.sizeBytes = ? AND artifact.sha256 = ? AND artifact.copyStatus <> 'copied'`,
      [claimToken, LEASE_SECONDS, claimToken, LEASE_SECONDS, row.id,
        request.artifact.legacyStorageId, request.artifact.path, request.artifact.mimeType,
        request.artifact.sizeBytes, request.artifact.sha256],
    ));
    if (updated !== 1) throw new Error('skill_package_asset_copy_source_unverified');
    await connection.commit();
    return { id: row.id, claimToken, request };
  } catch (error) {
    await connection.rollback();
    throw error;
  }
};

export const createMysqlSkillPackageAssetCopyRepository = (pool: Pool): SkillPackageAssetCopyQueue =>
  Object.freeze({
    claim: async () => {
      const connection = await pool.getConnection();
      try {
        const claim = await claimNext(connection);
        return claim && {
          id: claim.id,
          claimToken: claim.claimToken,
          domain: claim.request.domain,
          versionLegacyConvexId: claim.request.versionLegacyConvexId,
          artifact: claim.request.artifact,
          sourceVerified: true,
        };
      } finally {
        connection.release();
      }
    },
    complete: async (input: Readonly<{ id: string; claimToken: string; targetAssetId: string }>): Promise<boolean> =>
      affectedRows(await pool.query(
        `UPDATE convex_exit_outbox_events event
         INNER JOIN skill_package_version_snapshots version ON version.id = event.aggregateId
         INNER JOIN skill_package_artifact_snapshots artifact ON artifact.versionSnapshotId = version.id
         SET event.status = 'published', event.publishedAt = NOW(3), event.claimedAt = NULL,
             event.claimToken = NULL, event.leaseExpiresAt = NULL, event.failureReason = NULL,
             artifact.copyStatus = 'copied', artifact.targetAssetId = ?, artifact.claimToken = NULL,
             artifact.claimExpiresAt = NULL, artifact.failureCode = NULL
         WHERE event.id = ? AND event.status = 'processing' AND event.claimToken = ?
           AND artifact.claimToken = ?
           AND artifact.sha256 = JSON_UNQUOTE(JSON_EXTRACT(event.payload, '$.artifact.sha256'))`,
        [input.targetAssetId, input.id, input.claimToken, input.claimToken],
      )) === 1,
    fail: async (input: Readonly<{ id: string; claimToken: string; failureCode: string }>): Promise<boolean> =>
      affectedRows(await pool.query(
        `UPDATE convex_exit_outbox_events event
         INNER JOIN skill_package_version_snapshots version ON version.id = event.aggregateId
         INNER JOIN skill_package_artifact_snapshots artifact ON artifact.versionSnapshotId = version.id
         SET event.status = IF(event.attempts + 1 >= ?, 'failed', 'pending'),
             event.attempts = event.attempts + 1,
             event.availableAt = TIMESTAMPADD(SECOND, LEAST(POW(2, event.attempts + 1), ?), NOW(3)),
             event.claimedAt = NULL, event.claimToken = NULL, event.leaseExpiresAt = NULL,
             event.failedAt = IF(event.attempts + 1 >= ?, NOW(3), NULL), event.failureReason = ?,
             artifact.copyStatus = IF(event.attempts + 1 >= ?, 'failed', 'pending'),
             artifact.claimToken = NULL, artifact.claimExpiresAt = NULL, artifact.failureCode = ?
         WHERE event.id = ? AND event.status = 'processing' AND event.claimToken = ?
           AND artifact.claimToken = ?
           AND artifact.sha256 = JSON_UNQUOTE(JSON_EXTRACT(event.payload, '$.artifact.sha256'))`,
        [MAX_ATTEMPTS, MAX_BACKOFF_SECONDS, MAX_ATTEMPTS, input.failureCode.slice(0, 128),
          MAX_ATTEMPTS, input.failureCode.slice(0, 128), input.id, input.claimToken, input.claimToken],
      )) === 1,
  });