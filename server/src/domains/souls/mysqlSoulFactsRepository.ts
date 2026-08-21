import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import type { Pool, PoolConnection } from 'mysql2/promise';
import type { SoulSnapshot } from './soulMigrationDto.js';
import { normalizeSoulSnapshot } from './soulNormalizer.js';

export type SoulFactsRepository = Readonly<{
  upsert: (batchId: string, snapshot: SoulSnapshot) => Promise<string>;
  getBySlug: (slug: string) => Promise<SoulSnapshot | null>;
  getByLegacyId: (legacyId: string) => Promise<SoulSnapshot | null>;
  listAll: () => Promise<readonly SoulSnapshot[]>;
}>;

type SoulRow = RowDataPacket & Record<string, unknown>;
const asDate = (value: number) => new Date(value);
const asJson = (value: unknown): unknown => typeof value === 'string' ? JSON.parse(value) : value;

const readSnapshot = async (connection: Pool | PoolConnection, where: string, value: string): Promise<SoulSnapshot | null> => {
  const [souls] = await connection.query<SoulRow[]>(`SELECT * FROM soul_snapshots WHERE ${where} LIMIT 1`, [value]);
  const soul = souls[0];
  if (!soul) return null;
  const [versions] = await connection.query<SoulRow[]>('SELECT * FROM soul_version_snapshots WHERE soulSnapshotId = ? ORDER BY semanticVersion, legacyConvexId', [soul.id]);
  const files = versions.length === 0 ? [] : (await connection.query<SoulRow[]>('SELECT * FROM soul_version_file_snapshots WHERE soulVersionSnapshotId IN (?) ORDER BY path', [versions.map((row) => row.id)]))[0];
  return normalizeSoulSnapshot({
    legacyConvexId: soul.legacyConvexId as string, slug: soul.slug as string, displayName: soul.displayName as string,
    summary: soul.summary as string | null, ownerUserLegacyConvexId: soul.ownerUserLegacyConvexId as string,
    ownerPublisherLegacyConvexId: soul.ownerPublisherLegacyConvexId as string | null,
    latestVersionLegacyConvexId: soul.latestVersionLegacyConvexId as string | null,
    tags: asJson(soul.tags) as Record<string, string>, stats: asJson(soul.stats) as Record<string, number>, legacyCreatedAt: new Date(soul.legacyCreatedAt as string).getTime(),
    legacyUpdatedAt: new Date(soul.legacyUpdatedAt as string).getTime(), softDeletedAt: soul.softDeletedAt ? new Date(soul.softDeletedAt as string).getTime() : null,
    sourceHash: soul.sourceHash as string,
    versions: versions.map((version) => ({
      legacyConvexId: version.legacyConvexId as string, semanticVersion: version.semanticVersion as string, fingerprint: version.fingerprint as string | null,
      changelog: version.changelog as string, changelogSource: version.changelogSource as string | null, parsedMetadata: asJson(version.parsedMetadata) as Record<string, unknown>,
      createdByUserLegacyConvexId: version.createdByUserLegacyConvexId as string, legacyCreatedAt: new Date(version.legacyCreatedAt as string).getTime(),
      softDeletedAt: version.softDeletedAt ? new Date(version.softDeletedAt as string).getTime() : null, sourceHash: version.sourceHash as string,
      files: files.filter((file) => file.soulVersionSnapshotId === version.id).map((file) => ({ path: file.path as string, sizeBytes: Number(file.sizeBytes), mimeType: file.mimeType as string | null, sha256: file.sha256 as string, legacyStorageId: file.legacyStorageId as string | null, targetAssetId: file.targetAssetId as string | null, assetReferenceState: file.assetReferenceState as never })),
    })),
  });
};

export const createMysqlSoulFactsRepository = (pool: Pool): SoulFactsRepository => Object.freeze({
  upsert: async (batchId, raw) => {
    const snapshot = normalizeSoulSnapshot(raw);
    const connection = await pool.getConnection();
    const id = randomUUID();
    try {
      await connection.beginTransaction();
      await connection.query(`INSERT INTO soul_snapshots (id, legacyConvexId, slug, displayName, summary, ownerUserLegacyConvexId, ownerPublisherLegacyConvexId, latestVersionLegacyConvexId, tags, stats, legacyCreatedAt, legacyUpdatedAt, softDeletedAt, sourceHash, lastSeenBatchId, sourceMissingAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL) ON DUPLICATE KEY UPDATE slug=VALUES(slug), displayName=VALUES(displayName), summary=VALUES(summary), ownerUserLegacyConvexId=VALUES(ownerUserLegacyConvexId), ownerPublisherLegacyConvexId=VALUES(ownerPublisherLegacyConvexId), latestVersionLegacyConvexId=VALUES(latestVersionLegacyConvexId), tags=VALUES(tags), stats=VALUES(stats), legacyCreatedAt=VALUES(legacyCreatedAt), legacyUpdatedAt=VALUES(legacyUpdatedAt), softDeletedAt=VALUES(softDeletedAt), sourceHash=VALUES(sourceHash), lastSeenBatchId=VALUES(lastSeenBatchId), sourceMissingAt=NULL`, [id, snapshot.legacyConvexId, snapshot.slug, snapshot.displayName, snapshot.summary, snapshot.ownerUserLegacyConvexId, snapshot.ownerPublisherLegacyConvexId, snapshot.latestVersionLegacyConvexId, JSON.stringify(snapshot.tags), JSON.stringify(snapshot.stats), asDate(snapshot.legacyCreatedAt), asDate(snapshot.legacyUpdatedAt), snapshot.softDeletedAt ? asDate(snapshot.softDeletedAt) : null, snapshot.sourceHash, batchId]);
      const [rows] = await connection.query<SoulRow[]>('SELECT id FROM soul_snapshots WHERE legacyConvexId = ?', [snapshot.legacyConvexId]);
      const soulId = rows[0].id as string;
      for (const version of snapshot.versions) {
        const versionId = randomUUID();
        await connection.query(`INSERT INTO soul_version_snapshots (id, soulSnapshotId, legacyConvexId, semanticVersion, fingerprint, changelog, changelogSource, parsedMetadata, createdByUserLegacyConvexId, legacyCreatedAt, softDeletedAt, sourceHash, lastSeenBatchId, sourceMissingAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL) ON DUPLICATE KEY UPDATE semanticVersion=VALUES(semanticVersion), fingerprint=VALUES(fingerprint), changelog=VALUES(changelog), changelogSource=VALUES(changelogSource), parsedMetadata=VALUES(parsedMetadata), createdByUserLegacyConvexId=VALUES(createdByUserLegacyConvexId), legacyCreatedAt=VALUES(legacyCreatedAt), softDeletedAt=VALUES(softDeletedAt), sourceHash=VALUES(sourceHash), lastSeenBatchId=VALUES(lastSeenBatchId), sourceMissingAt=NULL`, [versionId, soulId, version.legacyConvexId, version.semanticVersion, version.fingerprint, version.changelog, version.changelogSource, JSON.stringify(version.parsedMetadata), version.createdByUserLegacyConvexId, asDate(version.legacyCreatedAt), version.softDeletedAt ? asDate(version.softDeletedAt) : null, version.sourceHash, batchId]);
        const [versionRows] = await connection.query<SoulRow[]>('SELECT id FROM soul_version_snapshots WHERE legacyConvexId = ?', [version.legacyConvexId]);
        const targetVersionId = versionRows[0].id as string;
        await connection.query('DELETE FROM soul_version_file_snapshots WHERE soulVersionSnapshotId = ?', [targetVersionId]);
        for (const file of version.files) await connection.query('INSERT INTO soul_version_file_snapshots (id, soulVersionSnapshotId, legacyStorageId, path, mimeType, sizeBytes, sha256, targetAssetId, assetReferenceState, sourceHash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [randomUUID(), targetVersionId, file.legacyStorageId, file.path, file.mimeType, file.sizeBytes, file.sha256, file.targetAssetId, file.assetReferenceState, snapshot.sourceHash]);
      }
      await connection.commit();
      return soulId;
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  },
  getBySlug: (slug) => readSnapshot(pool, 'slug = ? AND softDeletedAt IS NULL', slug.trim().toLowerCase()),
  getByLegacyId: (legacyId) => readSnapshot(pool, 'legacyConvexId = ? AND softDeletedAt IS NULL', legacyId),
  listAll: async () => {
    const [rows] = await pool.query<SoulRow[]>('SELECT legacyConvexId FROM soul_snapshots ORDER BY legacyConvexId');
    const snapshots = await Promise.all(rows.map((row) => readSnapshot(pool, 'legacyConvexId = ? AND softDeletedAt IS NULL', String(row.legacyConvexId))));
    return snapshots.filter((snapshot): snapshot is SoulSnapshot => snapshot !== null);
  },
});