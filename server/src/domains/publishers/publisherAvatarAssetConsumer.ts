import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import type { PublisherAvatarSourceReader } from "./convexPublisherAvatarSourceReader.js";
import type { PublisherAvatarAssetImporter } from "./publisherAvatarAssetImport.js";

const EVENT_TYPE = "publishers.avatar.import-requested";
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
  publisherId: string;
}>;

export type PublisherAvatarConsumeResult =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "imported"; eventId: string; assetId: string }>
  | Readonly<{ kind: "failed"; eventId: string; terminal: boolean; failureCode: string }>;

const parsePayload = (payload: unknown): AvatarEventPayload => {
  const value = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("publisher_avatar_payload_invalid");
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.legacyConvexId !== "string" ||
    !candidate.legacyConvexId ||
    typeof candidate.sourceStorageId !== "string" ||
    !candidate.sourceStorageId ||
    typeof candidate.publisherId !== "string" ||
    !candidate.publisherId
  ) {
    throw new Error("publisher_avatar_payload_invalid");
  }
  return {
    legacyConvexId: candidate.legacyConvexId,
    sourceStorageId: candidate.sourceStorageId,
    publisherId: candidate.publisherId,
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

const markImported = async (
  pool: Pool,
  event: Pick<AvatarEventRow, "id" | "claimToken">,
  payload: AvatarEventPayload,
  asset: Readonly<{
    assetId: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
  }>,
): Promise<void> => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `UPDATE publisher_avatar_snapshots avatar
       INNER JOIN publisher_snapshots publisher ON publisher.id = avatar.publisherId
       SET avatar.targetAssetId = ?, avatar.contentType = ?, avatar.byteLength = ?,
           avatar.sha256 = ?, avatar.accessScope = 'public', avatar.status = 'active',
           avatar.failureCode = NULL
       WHERE avatar.publisherId = ? AND avatar.sourceStorageId = ?
         AND publisher.legacyConvexId = ? AND publisher.kind = 'org'
         AND publisher.deletedAt IS NULL AND publisher.deactivatedAt IS NULL`,
      [
        asset.assetId,
        asset.mimeType,
        asset.sizeBytes,
        asset.sha256,
        payload.publisherId,
        payload.sourceStorageId,
        payload.legacyConvexId,
      ],
    );
    if (
      !result ||
      typeof result !== "object" ||
      !("affectedRows" in result) ||
      result.affectedRows !== 1
    ) {
      throw new Error("publisher_avatar_snapshot_not_active_org");
    }
    await connection.query(
      `UPDATE convex_exit_outbox_events
       SET status = 'published', publishedAt = NOW(3), claimedAt = NULL,
           claimToken = NULL, leaseExpiresAt = NULL, failureReason = NULL
       WHERE id = ? AND status = 'processing' AND claimToken = ?`,
      [event.id, event.claimToken],
    );
    await connection.commit();
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
): Promise<PublisherAvatarConsumeResult> => {
  const attempts = Number(row.attempts ?? 0) + 1;
  const terminal = attempts >= MAX_ATTEMPTS;
  const failureCode =
    error instanceof Error ? error.message.slice(0, 128) : "publisher_avatar_import_failed";
  await pool.query(
    `UPDATE convex_exit_outbox_events
     SET status = ?, attempts = ?, availableAt = TIMESTAMPADD(SECOND, ?, NOW(3)),
         claimedAt = NULL, claimToken = NULL, leaseExpiresAt = NULL, failedAt = ?, failureReason = ?
     WHERE id = ? AND status = 'processing' AND claimToken = ?`,
    [
      terminal ? "failed" : "pending",
      attempts,
      backoffSeconds(attempts),
      terminal ? new Date() : null,
      failureCode,
      row.id,
      row.claimToken,
    ],
  );
  if (payload) {
    await pool.query(
      `UPDATE publisher_avatar_snapshots avatar
       INNER JOIN publisher_snapshots publisher ON publisher.id = avatar.publisherId
       SET avatar.status = ?, avatar.failureCode = ?
       WHERE avatar.publisherId = ? AND avatar.sourceStorageId = ?
         AND publisher.legacyConvexId = ? AND publisher.kind = 'org'`,
      [
        terminal ? "failed" : "pending",
        failureCode,
        payload.publisherId,
        payload.sourceStorageId,
        payload.legacyConvexId,
      ],
    );
  }
  return { kind: "failed", eventId: row.id, terminal, failureCode };
};

export const createPublisherAvatarAssetConsumer = (
  input: Readonly<{
    pool: Pool;
    sourceReader: PublisherAvatarSourceReader;
    importer: PublisherAvatarAssetImporter;
  }>,
) =>
  Object.freeze({
    consumeNext: async (): Promise<PublisherAvatarConsumeResult> => {
      const connection = await input.pool.getConnection();
      let row: AvatarEventRow | null = null;
      try {
        row = await claimNext(connection);
      } finally {
        connection.release();
      }
      if (!row) return { kind: "idle" };

      let payload: AvatarEventPayload | null = null;
      try {
        payload = parsePayload(row.payload);
        if (payload.legacyConvexId !== row.aggregateId) {
          throw new Error("publisher_avatar_aggregate_mismatch");
        }
        const source = await input.sourceReader.read(payload.sourceStorageId);
        if (!source) throw new Error("publisher_avatar_source_missing");
        const asset = await input.importer.import({
          ownerLegacyConvexId: payload.legacyConvexId,
          source,
        });
        await markImported(input.pool, row, payload, asset);
        return { kind: "imported", eventId: row.id, assetId: asset.assetId };
      } catch (error) {
        return markFailed(input.pool, row, payload, error);
      }
    },
  });
