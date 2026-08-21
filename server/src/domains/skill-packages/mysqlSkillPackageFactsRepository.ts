import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { SkillPackageFacts } from './skillPackageMigrationPort.js';

export type SkillPackageFactsRepository = Readonly<{
  upsert: (input: Readonly<{ snapshotId: string; versionSnapshotIds: Readonly<Record<string, string>>; batchId: string; facts: SkillPackageFacts }>) => Promise<void>;
  read: (snapshotId: string) => Promise<SkillPackageFacts>;
}>;

type FactRow = RowDataPacket & Record<string, unknown>;
const date = (value: number | null) => value === null ? null : new Date(value);
const rows = async <T extends FactRow>(connection: PoolConnection | Pool, sql: string, values: readonly unknown[]) => (await connection.query<T[]>(sql, [...values]))[0];

const upsertRows = async (connection: PoolConnection, table: string, columns: readonly string[], key: readonly string[], values: readonly unknown[][]) => {
  if (values.length === 0) return;
  const placeholders = values.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
  const updates = columns.filter((column) => !key.includes(column)).map((column) => `\`${column}\` = VALUES(\`${column}\`)`).join(', ');
  await connection.query(`INSERT INTO \`${table}\` (${columns.map((column) => `\`${column}\``).join(', ')}) VALUES ${placeholders} ON DUPLICATE KEY UPDATE ${updates}`, values.flat());
};

export const createMysqlSkillPackageFactsRepository = (pool: Pool): SkillPackageFactsRepository => Object.freeze({
  upsert: async ({ snapshotId, versionSnapshotIds, batchId, facts }) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await upsertRows(connection, 'skill_package_alias_facts', ['id', 'snapshotId', 'legacyConvexId', 'aliasKind', 'aliasValue', 'isCanonical', 'retiredAt', 'sourceHash', 'lastSeenBatchId'], [], facts.aliases.map((fact, index) => [crypto.randomUUID(), snapshotId, `${snapshotId}:alias:${index}`, fact.aliasKind, fact.aliasValue, fact.isCanonical, date(fact.retiredAt), 'candidate', batchId]));
      if (facts.github) await upsertRows(connection, 'skill_package_github_facts', ['id', 'snapshotId', 'sourceLegacyConvexId', 'repository', 'path', 'commit', 'contentHash', 'status', 'sourceHash', 'lastSeenBatchId'], ['snapshotId'], [[crypto.randomUUID(), snapshotId, facts.github.sourceLegacyConvexId, facts.github.repository, facts.github.path, facts.github.commit, facts.github.contentHash, facts.github.status, 'candidate', batchId]]);
      for (const [versionKey, versionId] of Object.entries(versionSnapshotIds)) {
        const files = facts.versionFiles?.[versionKey] ?? [];
        await upsertRows(connection, 'skill_package_version_file_facts', ['id', 'versionSnapshotId', 'path', 'sizeBytes', 'mimeType', 'sha256', 'storageLegacyConvexId', 'sourceHash'], ['versionSnapshotId', 'path'], files.map((file) => [crypto.randomUUID(), versionId, file.path, file.sizeBytes, file.mimeType, file.sha256, file.storageLegacyConvexId, 'candidate']));
      }
      const factRows = [
        ['skill_package_ownership_facts', facts.ownership, ['id', 'snapshotId', 'legacyConvexId', 'ownerUserLegacyConvexId', 'ownerPublisherLegacyConvexId', 'eventKind', 'effectiveAt', 'actorUserLegacyConvexId', 'sourceHash', 'lastSeenBatchId'], (fact: any, index: number) => [crypto.randomUUID(), snapshotId, `${snapshotId}:ownership:${index}`, fact.ownerUserLegacyConvexId, fact.ownerPublisherLegacyConvexId, fact.eventKind, date(fact.effectiveAt), fact.actorUserLegacyConvexId, 'candidate', batchId]],
        ['package_publish_token_facts', facts.publishTokens, ['id', 'snapshotId', 'legacyConvexId', 'tokenHash', 'provider', 'repository', 'workflowFilename', 'expiresAt', 'lastUsedAt', 'revokedAt', 'sourceHash', 'lastSeenBatchId'], (fact: any) => [crypto.randomUUID(), snapshotId, fact.legacyConvexId, fact.tokenHash, fact.provider, fact.repository, fact.workflowFilename, date(fact.expiresAt), date(fact.lastUsedAt), date(fact.revokedAt), 'candidate', batchId]],
        ['package_publish_upload_ticket_facts', facts.uploadTickets, ['id', 'snapshotId', 'legacyConvexId', 'kind', 'publishTokenLegacyConvexId', 'userLegacyConvexId', 'createdAt', 'expiresAt', 'usedAt', 'storageLegacyConvexId', 'sourceHash', 'lastSeenBatchId'], (fact: any) => [crypto.randomUUID(), snapshotId, fact.legacyConvexId, fact.kind, fact.publishTokenLegacyConvexId, fact.userLegacyConvexId, date(fact.createdAt), date(fact.expiresAt), date(fact.usedAt), fact.storageLegacyConvexId, 'candidate', batchId]],
        ['package_trusted_publisher_facts', facts.trustedPublishers, ['id', 'snapshotId', 'legacyConvexId', 'provider', 'repository', 'repositoryId', 'workflowFilename', 'environment', 'sourceHash', 'lastSeenBatchId'], (fact: any) => [crypto.randomUUID(), snapshotId, fact.legacyConvexId, fact.provider, fact.repository, fact.repositoryId, fact.workflowFilename, fact.environment, 'candidate', batchId]],
        ['package_inspector_facts', facts.inspector, ['id', 'snapshotId', 'legacyConvexId', 'releaseLegacyConvexId', 'status', 'inspectorVersion', 'targetRuntimeVersion', 'findingCount', 'findingsHash', 'observedAt', 'sourceHash', 'lastSeenBatchId'], (fact: any) => [crypto.randomUUID(), snapshotId, fact.legacyConvexId, fact.releaseLegacyConvexId, fact.status, fact.inspectorVersion, fact.targetRuntimeVersion, fact.findingCount, fact.findingsHash, date(fact.createdAt), 'candidate', batchId]],
      ] as const;
      for (const [table, list, columns, map] of factRows) await upsertRows(connection, table, columns, [], list.map(map));
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  },
  read: async (snapshotId) => {
    const [aliases, github, ownership, tokens, uploads, publishers, inspector, files] = await Promise.all([
      rows(pool as unknown as PoolConnection, 'SELECT aliasKind, aliasValue, isCanonical, retiredAt FROM skill_package_alias_facts WHERE snapshotId = ?', [snapshotId]),
      rows(pool as unknown as PoolConnection, 'SELECT sourceLegacyConvexId, repository, path, `commit`, contentHash, status FROM skill_package_github_facts WHERE snapshotId = ?', [snapshotId]),
      rows(pool as unknown as PoolConnection, 'SELECT ownerUserLegacyConvexId, ownerPublisherLegacyConvexId, eventKind, effectiveAt, actorUserLegacyConvexId FROM skill_package_ownership_facts WHERE snapshotId = ?', [snapshotId]),
      rows(pool as unknown as PoolConnection, 'SELECT legacyConvexId, tokenHash, provider, repository, workflowFilename, expiresAt, lastUsedAt, revokedAt FROM package_publish_token_facts WHERE snapshotId = ?', [snapshotId]),
      rows(pool as unknown as PoolConnection, 'SELECT legacyConvexId, kind, publishTokenLegacyConvexId, userLegacyConvexId, createdAt, expiresAt, usedAt, storageLegacyConvexId FROM package_publish_upload_ticket_facts WHERE snapshotId = ?', [snapshotId]),
      rows(pool as unknown as PoolConnection, 'SELECT legacyConvexId, provider, repository, repositoryId, workflowFilename, environment FROM package_trusted_publisher_facts WHERE snapshotId = ?', [snapshotId]),
      rows(pool as unknown as PoolConnection, 'SELECT legacyConvexId, releaseLegacyConvexId, status, inspectorVersion, targetRuntimeVersion, findingCount, findingsHash, observedAt FROM package_inspector_facts WHERE snapshotId = ?', [snapshotId]),
      rows(pool as unknown as PoolConnection, 'SELECT versionSnapshotId, path, sizeBytes, mimeType, sha256, storageLegacyConvexId FROM skill_package_version_file_facts WHERE versionSnapshotId IN (SELECT id FROM skill_package_version_snapshots WHERE snapshotId = ?)', [snapshotId]),
    ]);
    const versionFiles: Record<string, any[]> = {};
    for (const file of files) (versionFiles[file.versionSnapshotId as string] ??= []).push({ path: file.path, sizeBytes: Number(file.sizeBytes), mimeType: file.mimeType, sha256: file.sha256, storageLegacyConvexId: file.storageLegacyConvexId });
    return { aliases: aliases.map((row) => ({ aliasKind: row.aliasKind, aliasValue: row.aliasValue, isCanonical: Boolean(row.isCanonical), retiredAt: row.retiredAt ? new Date(row.retiredAt as string).getTime() : null })), github: github[0] ? { ...github[0] } as any : null, fingerprint: null, ownership: ownership.map((row) => ({ ...row, effectiveAt: new Date(row.effectiveAt as string).getTime() })) as any, publishTokens: tokens.map((row) => ({ ...row, expiresAt: new Date(row.expiresAt as string).getTime(), lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt as string).getTime() : null, revokedAt: row.revokedAt ? new Date(row.revokedAt as string).getTime() : null })) as any, uploadTickets: uploads.map((row) => ({ ...row, createdAt: new Date(row.createdAt as string).getTime(), expiresAt: new Date(row.expiresAt as string).getTime(), usedAt: row.usedAt ? new Date(row.usedAt as string).getTime() : null })) as any, trustedPublishers: publishers as any, inspector: inspector.map((row) => ({ ...row, createdAt: new Date(row.observedAt as string).getTime() })) as any, installEligibility: null, versionFiles } as any;
  },
});