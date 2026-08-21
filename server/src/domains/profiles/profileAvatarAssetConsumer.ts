import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { ProfileAvatarAssetImporter } from './profileAvatarAssetImport.js';
import type { ProfileAvatarSourceReader } from './convexProfileAvatarSourceReader.js';

const EVENT_TYPE = 'profiles.avatar.import-requested';
const MAX_ATTEMPTS = 8;
const MAX_BACKOFF_SECONDS = 300;
const LEASE_SECONDS = 120;

type AvatarEventRow = RowDataPacket & {
  id: string;
  aggregateId: string;
  payload: unknown;
  attempts: number;
  claimToken: string;
};

type AvatarEventPayload = Readonly<{
  legacyConvexId: string;
  sourceStorageId: string;
  profileId: string;
}>;

export type ProfileAvatarConsumeResult =
  | Readonly<{ kind: 'idle' }>
  | Readonly<{ kind: 'imported'; eventId: string; assetId: string }>
  | Readonly<{ kind: 'failed'; eventId: string; terminal: boolean; failureCode: string }>
  | Readonly<{ kind: 'lost'; eventId: string; reason: 'profile_avatar_lease_lost' }>;

const parsePayload = (payload: unknown): AvatarEventPayload => {
  const value = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('profile_avatar_payload_invalid');
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.legacyConvexId !== 'string' ||
    !candidate.legacyConvexId ||
    typeof candidate.sourceStorageId !== 'string' ||
    !candidate.sourceStorageId ||
    typeof candidate.profileId !== 'string' ||
    !candidate.profileId
  ) {
    throw new Error('profile_avatar_payload_invalid');
  }
  return {
    legacyConvexId: candidate.legacyConvexId,
    sourceStorageId: candidate.sourceStorageId,
    profileId: candidate.profileId,
  };
};

const backoffSeconds = (attempts: number): number =>
  Math.min(2 ** Math.max(0, attempts), MAX_BACKOFF_SECONDS);

const claimNext = async (connection: PoolConnection): Promise<AvatarEventRow | null> => {
  await connection.beginTransaction();
  try {
    const [rows] = await connection.query<AvatarEventRow[]>(
      `SELECT id, aggregateId, payload, attempts
       FROM convex_exit_outbox_events
       WHERE eventType = ?
         AND (
           (status = 'pending' AND availableAt <= NOW(3))
           OR (status = 'processing' AND leaseExpiresAt <= NOW(3))
         )
       ORDER BY occurredAt ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [EVENT_TYPE],
    );
    const row = rows[0] ?? null;
    if (!row) {
      await connection.rollback();
      return null;
    }
    const claimToken = randomUUID();
    await connection.query(
      `UPDATE convex_exit_outbox_events
       SET status = 'processing', claimedAt = NOW(3), claimToken = ?,
           leaseExpiresAt = TIMESTAMPADD(SECOND, ?, NOW(3)), failureReason = NULL
       WHERE id = ?`,
      [claimToken, LEASE_SECONDS, row.id],
    );
    await connection.commit();
    return { ...row, claimToken };
  } catch (error) {
    await connection.rollback();
    throw error;
  }
};

type QueryResult = Readonly<{ affectedRows?: number | bigint }>;

const affectedRows = (result: unknown): number => {
  if (!Array.isArray(result) || !result[0] || typeof result[0] !== 'object') return 0;
  const value = (result[0] as QueryResult).affectedRows;
  return Number(value ?? 0);
};

const markImported = async (
  pool: Pool,
  event: Pick<AvatarEventRow, 'id' | 'claimToken'>,
  payload: AvatarEventPayload,
  asset: Readonly<{
    assetId: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
  }>,
): Promise<boolean> => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const publication = await connection.query(
      `UPDATE convex_exit_outbox_events
       SET status = 'published', publishedAt = NOW(3), claimedAt = NULL,
           claimToken = NULL, leaseExpiresAt = NULL, failureReason = NULL
       WHERE id = ? AND status = 'processing' AND claimToken = ?`,
      [event.id, event.claimToken],
    );
    if (affectedRows(publication) !== 1) {
      await connection.rollback();
      return false;
    }
    await connection.query(
      `UPDATE profile_asset_snapshots
       SET targetAssetId = ?, contentType = ?, byteLength = ?, sha256 = ?,
           acl = 'public', visibility = 'public', status = 'active', failureCode = NULL
       WHERE profileId = ? AND sourceStorageId = ? AND deletedAt IS NULL`,
      [
        asset.assetId,
        asset.mimeType,
        asset.sizeBytes,
        asset.sha256,
        payload.profileId,
        payload.sourceStorageId,
      ],
    );
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const markFailed = async (
  pool: Pool,
  row: AvatarEventRow,
  payload: AvatarEventPayload | null,
  error: unknown,
): Promise<ProfileAvatarConsumeResult> => {
  const attempts = Number(row.attempts ?? 0) + 1;
  const terminal = attempts >= MAX_ATTEMPTS;
  const failureCode = error instanceof Error ? error.message.slice(0, 128) : 'profile_avatar_import_failed';
  const failureUpdate = await pool.query(
    `UPDATE convex_exit_outbox_events
     SET status = ?, attempts = ?, availableAt = TIMESTAMPADD(SECOND, ?, NOW(3)),
         claimedAt = NULL, claimToken = NULL, leaseExpiresAt = NULL, failedAt = ?, failureReason = ?
     WHERE id = ? AND status = 'processing' AND claimToken = ?`,
    [
      terminal ? 'failed' : 'pending',
      attempts,
      backoffSeconds(attempts),
      terminal ? new Date() : null,
      failureCode,
      row.id,
      row.claimToken,
    ],
  );
  if (payload && affectedRows(failureUpdate) === 1) {
    await pool.query(
      `UPDATE profile_asset_snapshots
       SET status = ?, failureCode = ?
       WHERE profileId = ? AND sourceStorageId = ? AND deletedAt IS NULL AND status <> 'active'`,
      [terminal ? 'failed' : 'pending', failureCode, payload.profileId, payload.sourceStorageId],
    );
  }
  return { kind: 'failed', eventId: row.id, terminal, failureCode };
};

export const createProfileAvatarAssetConsumer = (input: Readonly<{
  pool: Pool;
  sourceReader: ProfileAvatarSourceReader;
  importer: ProfileAvatarAssetImporter;
}>) =>
  Object.freeze({
    consumeNext: async (): Promise<ProfileAvatarConsumeResult> => {
      const connection = await input.pool.getConnection();
      let row: AvatarEventRow | null = null;
      try {
        row = await claimNext(connection);
      } finally {
        connection.release();
      }
      if (!row) return { kind: 'idle' };

      let payload: AvatarEventPayload | null = null;
      try {
        payload = parsePayload(row.payload);
        if (payload.legacyConvexId !== row.aggregateId) {
          throw new Error('profile_avatar_aggregate_mismatch');
        }
        const source = await input.sourceReader.read(payload.sourceStorageId);
        if (!source) throw new Error('profile_avatar_source_missing');
        const asset = await input.importer.import({
          ownerLegacyConvexId: payload.legacyConvexId,
          source,
        });
        const imported = await markImported(input.pool, row, payload, asset);
        if (!imported) {
          return { kind: 'lost', eventId: row.id, reason: 'profile_avatar_lease_lost' };
        }
        return { kind: 'imported', eventId: row.id, assetId: asset.assetId };
      } catch (error) {
        return markFailed(input.pool, row, payload, error);
      }
    },
  });