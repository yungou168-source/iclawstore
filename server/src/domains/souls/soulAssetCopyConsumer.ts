import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { ManagedAssetStore } from '../../services/managedAssetStore.js';

type SoulAssetRow = RowDataPacket & Record<string, unknown>;
type StoredAssetRow = RowDataPacket & { id: string; storageKey: string; mimeType: string; sizeBytes: number; sha256: string };
export type SoulAssetSource = Readonly<{ open: (legacyStorageId: string) => Promise<Readable> }>;
export type SoulAssetCopyErrorKind = 'source_missing' | 'source_read_failed' | 'integrity_mismatch' | 'store_failed' | 'database_failed';

const classify = (error: unknown, stage: 'source' | 'store' | 'database'): SoulAssetCopyErrorKind => {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (stage === 'store') return 'store_failed';
  if (stage === 'database') return 'database_failed';
  if (message.includes('not found') || message.includes('missing') || message.includes('enoent')) return 'source_missing';
  if (message.includes('hash') || message.includes('size') || message.includes('mime')) return 'integrity_mismatch';
  return 'source_read_failed';
};

export const createSoulAssetCopyConsumer = (input: Readonly<{ pool: Pool; source: SoulAssetSource; store: ManagedAssetStore }>) => ({
  async copyPending(limit = 50): Promise<{ copied: number; failed: number; retryable: number; permanent: number }> {
    const [rows] = await input.pool.query<SoulAssetRow[]>("SELECT id, soulVersionSnapshotId, legacyStorageId, path, mimeType, sizeBytes, sha256 FROM soul_version_file_snapshots WHERE assetReferenceState IN ('pending', 'retryable_failed') AND legacyStorageId IS NOT NULL ORDER BY createdAt LIMIT ?", [limit]);
    let copied = 0; let failed = 0; let retryable = 0; let permanent = 0;
    for (const row of rows) {
      const fileId = String(row.id);
      const legacyStorageId = String(row.legacyStorageId);
      let stage: 'source' | 'store' | 'database' = 'source';
      try {
        const stream = await input.source.open(legacyStorageId);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        const bytes = Buffer.concat(chunks);
        const digest = createHash('sha256').update(bytes).digest('hex');
        if (digest !== String(row.sha256).toLowerCase() || bytes.length !== Number(row.sizeBytes)) throw new Error('Soul asset hash or size mismatch');
        stage = 'store';
        const stored = await input.store.store({ kind: 'template_package', originalFileName: String(row.path).split('/').pop() ?? 'soul.bin', declaredMimeType: String(row.mimeType ?? 'application/octet-stream'), stream: Readable.from(bytes) });
        if (stored.sha256 !== digest || stored.sizeBytes !== bytes.length || (row.mimeType && stored.mimeType !== String(row.mimeType))) throw new Error('Managed asset metadata mismatch');
        stage = 'database';
        await input.pool.query(`INSERT INTO convex_exit_managed_assets (id, legacyStorageId, ownerDomain, ownerLegacyConvexId, accessScope, storageKey, originalFileName, mimeType, sizeBytes, sha256, status, scannerStatus, createdByUserId, targetId) VALUES (?, ?, 'souls', ?, 'private', ?, ?, ?, ?, ?, 'active', 'pending', NULL, ?) ON DUPLICATE KEY UPDATE storageKey=VALUES(storageKey), sizeBytes=VALUES(sizeBytes), sha256=VALUES(sha256), status='active', scannerStatus='pending'`, [randomUUID(), legacyStorageId, row.soulVersionSnapshotId, stored.storageKey, stored.originalFileName, stored.mimeType, stored.sizeBytes, stored.sha256, row.soulVersionSnapshotId]);
        const [assets] = await input.pool.query<StoredAssetRow[]>('SELECT id, storageKey, mimeType, sizeBytes, sha256 FROM convex_exit_managed_assets WHERE legacyStorageId = ? LIMIT 1', [legacyStorageId]);
        const asset = assets[0];
        if (!asset || asset.sha256 !== digest || Number(asset.sizeBytes) !== bytes.length) throw new Error('Managed asset database metadata mismatch');
        const [updated] = await input.pool.query('UPDATE soul_version_file_snapshots SET targetAssetId = ?, assetReferenceState = \'copied\', assetReferenceErrorKind = NULL, assetReferenceError = NULL, assetReferenceUpdatedAt = NOW(3) WHERE id = ? AND assetReferenceState IN (\'pending\', \'retryable_failed\')', [asset.id, fileId]);
        if ((updated as { affectedRows?: number }).affectedRows !== 1) throw new Error('Asset reference state transition was not applied');
        copied += 1;
      } catch (error) {
        failed += 1;
        const kind = classify(error, stage);
        const isRetryable = kind === 'source_read_failed' || kind === 'store_failed' || kind === 'database_failed';
        if (isRetryable) retryable += 1; else permanent += 1;
        await input.pool.query("UPDATE soul_version_file_snapshots SET assetReferenceState = ?, assetReferenceErrorKind = ?, assetReferenceError = ?, assetReferenceUpdatedAt = NOW(3) WHERE id = ? AND assetReferenceState IN ('pending', 'retryable_failed')", [isRetryable ? 'retryable_failed' : 'permanent_failed', kind, error instanceof Error ? error.message.slice(0, 500) : 'unknown failure', fileId]);
      }
    }
    return { copied, failed, retryable, permanent };
  },
});