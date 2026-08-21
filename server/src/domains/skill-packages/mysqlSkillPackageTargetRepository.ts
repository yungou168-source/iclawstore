import { randomUUID } from 'node:crypto';
import type {
  Pool,
  PoolConnection,
  RowDataPacket,
} from 'mysql2/promise';
import type {
  SkillPackageAggregateSnapshot,
  SkillPackageArtifactSnapshot,
  SkillPackageImportPage,
  SkillPackageImportResult,
  SkillPackageSourcePage,
  SkillPackageTargetRepository,
  SkillPackageVersionSnapshot,
} from './skillPackageMigrationPort.js';

type SnapshotRow = RowDataPacket & { id: string; sourceHash: string };
type LegacyMapRow = RowDataPacket & { targetId: string };
type AggregateRow = RowDataPacket & {
  id: string;
  domain: 'skill' | 'package';
  legacyConvexId: string;
  ownerPublisherLegacyConvexId: string | null;
  canonicalName: string;
  displayName: string;
  summary: string | null;
  visibility: 'public' | 'private' | 'hidden' | 'deleted';
  metadata: unknown;
  legacyUpdatedAt: Date | string;
  sourceHash: string;
};
type VersionRow = RowDataPacket & {
  id: string;
  snapshotId: string;
  legacyConvexId: string;
  semanticVersion: string;
  sourceHash: string;
  sourceMetadata: unknown;
  scanSnapshot: unknown;
  legacyCreatedAt: Date | string;
  legacyUpdatedAt: Date | string;
};
type ArtifactRow = RowDataPacket & {
  versionSnapshotId: string;
  legacyStorageId: string | null;
  path: string;
  mimeType: string;
  sizeBytes: number | bigint | string;
  sha256: string;
};

const decodeCursor = (cursor: string | null): string | null => {
  if (!cursor) return null;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    return decoded || null;
  } catch {
    throw new Error('skill_package_target_cursor_invalid');
  }
};

const encodeCursor = (legacyConvexId: string): string => Buffer.from(legacyConvexId).toString('base64url');

const asRecord = (value: unknown): Readonly<Record<string, unknown>> => {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Readonly<Record<string, unknown>>
    : {};
};

const asDateMs = (value: Date | string): number => new Date(value).getTime();

const placeholders = (count: number): string => Array.from({ length: count }, () => '?').join(', ');

const assertLegacyMap = async (
  connection: PoolConnection,
  domain: string,
  legacyConvexId: string,
  targetId: string,
) => {
  const [rows] = await connection.query<LegacyMapRow[]>(
    `SELECT targetId FROM convex_exit_legacy_id_maps
     WHERE domain = ? AND legacyConvexId = ? LIMIT 1 FOR UPDATE`,
    [domain, legacyConvexId],
  );
  if (rows[0] && rows[0].targetId !== targetId) {
    throw new Error('Legacy Convex ID maps to a different target ID');
  }
  await connection.query(
    `INSERT INTO convex_exit_legacy_id_maps (domain, legacyConvexId, targetId)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE targetId = VALUES(targetId)`,
    [domain, legacyConvexId, targetId],
  );
};

const upsertAggregate = async (
  connection: PoolConnection,
  batchId: string,
  aggregate: SkillPackageAggregateSnapshot,
) => {
  const [rows] = await connection.query<SnapshotRow[]>(
    `SELECT id, sourceHash FROM skill_package_snapshots
     WHERE domain = ? AND legacyConvexId = ? LIMIT 1 FOR UPDATE`,
    [aggregate.domain, aggregate.legacyConvexId],
  );
  const existing = rows[0];
  const id = existing?.id ?? randomUUID();
  await assertLegacyMap(connection, `skill_package_${aggregate.domain}`, aggregate.legacyConvexId, id);
  if (existing?.sourceHash === aggregate.sourceHash) {
    await connection.query(
      `UPDATE skill_package_snapshots SET lastSeenBatchId = ?, sourceMissingAt = NULL
       WHERE id = ?`,
      [batchId, id],
    );
    return 'unchanged' as const;
  }
  await connection.query(
    `INSERT INTO skill_package_snapshots
       (id, domain, legacyConvexId, ownerPublisherLegacyConvexId, canonicalName, displayName,
        summary, visibility, metadata, legacyUpdatedAt, sourceHash, lastSeenBatchId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), FROM_UNIXTIME(? / 1000), ?, ?)
     ON DUPLICATE KEY UPDATE ownerPublisherLegacyConvexId = VALUES(ownerPublisherLegacyConvexId),
       canonicalName = VALUES(canonicalName), displayName = VALUES(displayName), summary = VALUES(summary),
       visibility = VALUES(visibility), metadata = VALUES(metadata), legacyUpdatedAt = VALUES(legacyUpdatedAt),
       sourceHash = VALUES(sourceHash), lastSeenBatchId = VALUES(lastSeenBatchId), sourceMissingAt = NULL`,
    [id, aggregate.domain, aggregate.legacyConvexId, aggregate.ownerPublisherLegacyConvexId,
      aggregate.canonicalName, aggregate.displayName, aggregate.summary, aggregate.visibility,
      JSON.stringify(aggregate.metadata), aggregate.legacyUpdatedAt, aggregate.sourceHash, batchId],
  );
  for (const version of aggregate.versions) {
    const versionId = randomUUID();
    await connection.query(
      `INSERT INTO skill_package_version_snapshots
       (id, snapshotId, legacyConvexId, semanticVersion, sourceHash, sourceMetadata, scanSnapshot,
        legacyCreatedAt, legacyUpdatedAt, lastSeenBatchId)
       VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000), ?)
       ON DUPLICATE KEY UPDATE sourceHash = VALUES(sourceHash), sourceMetadata = VALUES(sourceMetadata),
        scanSnapshot = VALUES(scanSnapshot), legacyUpdatedAt = VALUES(legacyUpdatedAt),
        lastSeenBatchId = VALUES(lastSeenBatchId), sourceMissingAt = NULL`,
      [versionId, id, version.legacyConvexId, version.semanticVersion, version.sourceHash,
        JSON.stringify(version.sourceMetadata), JSON.stringify(version.scanSnapshot), version.legacyCreatedAt,
        version.legacyUpdatedAt, batchId],
    );
    const [versionRows] = await connection.query<SnapshotRow[]>(
      'SELECT id, sourceHash FROM skill_package_version_snapshots WHERE legacyConvexId = ? LIMIT 1',
      [version.legacyConvexId],
    );
    const persistedVersionId = versionRows[0]!.id;
    await assertLegacyMap(connection, 'skill_package_version', version.legacyConvexId, persistedVersionId);
    for (const artifact of version.artifacts) {
      const artifactId = randomUUID();
      await connection.query(
        `INSERT INTO skill_package_artifact_snapshots
         (id, versionSnapshotId, legacyStorageId, path, mimeType, sizeBytes, sha256, sourceHash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE legacyStorageId = VALUES(legacyStorageId), path = VALUES(path),
          mimeType = VALUES(mimeType), sizeBytes = VALUES(sizeBytes), sha256 = VALUES(sha256),
          sourceHash = VALUES(sourceHash)`,
        [artifactId, persistedVersionId, artifact.legacyStorageId, artifact.path, artifact.mimeType,
          artifact.sizeBytes, artifact.sha256, version.sourceHash],
      );
      await connection.query(
        `INSERT INTO convex_exit_outbox_events
         (id, domain, aggregateId, aggregateVersion, eventType, idempotencyKey, payload)
         VALUES (?, ?, ?, ?, 'skill-package.asset.copy-requested', ?, CAST(? AS JSON))
         ON DUPLICATE KEY UPDATE id = id`,
        [randomUUID(), `skill_package_${aggregate.domain}`, persistedVersionId, 1,
          `skill-package:${aggregate.domain}:${version.legacyConvexId}:${artifact.sha256}`,
          JSON.stringify({ domain: aggregate.domain, versionLegacyConvexId: version.legacyConvexId, artifact })],
      );
    }
  }
  return 'upserted' as const;
};

export const createMysqlSkillPackageTargetRepository = (pool: Pool): SkillPackageTargetRepository =>
  Object.freeze({
    importPage: async (page: SkillPackageImportPage): Promise<SkillPackageImportResult> => {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        let upsertedCount = 0;
        let unchangedCount = 0;
        for (const item of page.items) {
          const outcome = await upsertAggregate(connection, page.batchId, item);
          if (outcome === 'upserted') upsertedCount++;
          else unchangedCount++;
        }
        await connection.query(
          `UPDATE convex_exit_migration_batches
           SET sourceCursor = ?, status = IF(?, 'completed', 'running'),
             upsertedCount = upsertedCount + ?, unchangedCount = unchangedCount + ?,
             completedAt = IF(?, CURRENT_TIMESTAMP(3), NULL)
           WHERE id = ? AND status <> 'completed'`,
          [page.nextCursor, page.done, upsertedCount, unchangedCount, page.done, page.batchId],
        );
        await connection.commit();
        return { upsertedCount, unchangedCount };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
    listAggregates: async ({ domain, cursor, limit }): Promise<SkillPackageSourcePage<SkillPackageAggregateSnapshot>> => {
      if (!Number.isInteger(limit) || limit < 1 || limit > 250) {
        throw new Error('skill_package_target_page_limit_invalid');
      }
      const afterLegacyConvexId = decodeCursor(cursor);
      const [aggregateRows] = await pool.query<AggregateRow[]>(
        `SELECT id, domain, legacyConvexId, ownerPublisherLegacyConvexId, canonicalName, displayName,
                summary, visibility, metadata, legacyUpdatedAt, sourceHash
         FROM skill_package_snapshots
         WHERE domain = ? AND (? IS NULL OR legacyConvexId > ?)
         ORDER BY legacyConvexId ASC
         LIMIT ?`,
        [domain, afterLegacyConvexId, afterLegacyConvexId, limit + 1],
      );
      const pageRows = aggregateRows.slice(0, limit);
      if (pageRows.length === 0) return { items: [], cursor: null, done: true };
      const snapshotIds = pageRows.map((row) => row.id);
      const [versionRows] = await pool.query<VersionRow[]>(
        `SELECT id, snapshotId, legacyConvexId, semanticVersion, sourceHash, sourceMetadata, scanSnapshot,
                legacyCreatedAt, legacyUpdatedAt
         FROM skill_package_version_snapshots
         WHERE snapshotId IN (${placeholders(snapshotIds.length)})
         ORDER BY snapshotId ASC, semanticVersion ASC`,
        snapshotIds,
      );
      const versionIds = versionRows.map((row) => row.legacyConvexId);
      const [artifactRows] = versionIds.length === 0
        ? [[] as ArtifactRow[]]
        : await pool.query<ArtifactRow[]>(
          `SELECT artifact.versionSnapshotId, artifact.legacyStorageId, artifact.path, artifact.mimeType,
                  artifact.sizeBytes, artifact.sha256
           FROM skill_package_artifact_snapshots artifact
           INNER JOIN skill_package_version_snapshots version ON version.id = artifact.versionSnapshotId
           WHERE version.legacyConvexId IN (${placeholders(versionIds.length)})
           ORDER BY artifact.versionSnapshotId ASC, artifact.path ASC`,
          versionIds,
        );
      const artifactsByVersion = new Map<string, SkillPackageArtifactSnapshot[]>();
      for (const artifact of artifactRows) {
        const list = artifactsByVersion.get(artifact.versionSnapshotId) ?? [];
        list.push({ legacyStorageId: artifact.legacyStorageId, path: artifact.path, mimeType: artifact.mimeType,
          sizeBytes: Number(artifact.sizeBytes), sha256: artifact.sha256 });
        artifactsByVersion.set(artifact.versionSnapshotId, list);
      }
      const versionsBySnapshot = new Map<string, SkillPackageVersionSnapshot[]>();
      for (const version of versionRows) {
        const list = versionsBySnapshot.get(version.snapshotId) ?? [];
        list.push({ legacyConvexId: version.legacyConvexId, semanticVersion: version.semanticVersion,
          sourceHash: version.sourceHash, sourceMetadata: asRecord(version.sourceMetadata),
          scanSnapshot: version.scanSnapshot === null ? null : asRecord(version.scanSnapshot),
          legacyCreatedAt: asDateMs(version.legacyCreatedAt), legacyUpdatedAt: asDateMs(version.legacyUpdatedAt),
          artifacts: artifactsByVersion.get(version.id) ?? [] });
        versionsBySnapshot.set(version.snapshotId, list);
      }
      const hasMore = aggregateRows.length > limit;
      const finalRow = pageRows.at(-1)!;
      return {
        items: pageRows.map((row) => ({
          domain: row.domain, legacyConvexId: row.legacyConvexId,
          ownerPublisherLegacyConvexId: row.ownerPublisherLegacyConvexId,
          canonicalName: row.canonicalName, displayName: row.displayName, summary: row.summary,
          visibility: row.visibility, metadata: asRecord(row.metadata), legacyUpdatedAt: asDateMs(row.legacyUpdatedAt),
          sourceHash: row.sourceHash, versions: versionsBySnapshot.get(row.id) ?? [],
        })),
        cursor: hasMore ? encodeCursor(finalRow.legacyConvexId) : null,
        done: !hasMore,
      };
    },
  });