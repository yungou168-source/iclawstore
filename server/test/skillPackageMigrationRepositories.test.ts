import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { createMysqlSkillPackageAssetCopyRepository } from '../src/domains/skill-packages/mysqlSkillPackageAssetCopyRepository.js';
import { createMysqlSkillPackageTargetRepository } from '../src/domains/skill-packages/mysqlSkillPackageTargetRepository.js';
import { createSkillPackageReconciliationCheckpointRepository } from '../src/domains/skill-packages/skillPackageReconciliationCheckpointRepository.js';
import { createSkillPackageReconciliationReportRepository } from '../src/domains/skill-packages/skillPackageReconciliationReportRepository.js';

type Query = ReturnType<typeof vi.fn>;

const connection = (query: Query) => ({
  beginTransaction: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue(undefined),
  rollback: vi.fn().mockResolvedValue(undefined),
  release: vi.fn(),
  query,
});

describe('Skill/package candidate reconciliation repositories', () => {
  it('reads a target page with nested versions and artifacts without opening a connection at construction', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([[{
        id: 'aggregate-1', domain: 'skill', legacyConvexId: 'skills:one', ownerPublisherLegacyConvexId: null,
        canonicalName: 'one', displayName: 'One', summary: null, visibility: 'public', metadata: '{"kind":"test"}',
        legacyUpdatedAt: '2026-01-01T00:00:00.000Z', sourceHash: 'a'.repeat(64),
      }], []])
      .mockResolvedValueOnce([[{
        id: 'version-1', snapshotId: 'aggregate-1', legacyConvexId: 'versions:one', semanticVersion: '1.0.0',
        sourceHash: 'b'.repeat(64), sourceMetadata: '{"origin":"convex"}', scanSnapshot: null,
        legacyCreatedAt: '2026-01-01T00:00:00.000Z', legacyUpdatedAt: '2026-01-01T00:00:00.000Z',
      }], []])
      .mockResolvedValueOnce([[{
        versionSnapshotId: 'version-1', legacyStorageId: 'storage:one', path: 'SKILL.md', mimeType: 'text/markdown',
        sizeBytes: 3, sha256: 'c'.repeat(64),
      }], []]);
    const pool = { query, getConnection: vi.fn() } as unknown as Pool;
    const repository = createMysqlSkillPackageTargetRepository(pool);

    await expect(repository.listAggregates({ domain: 'skill', cursor: null, limit: 1 })).resolves.toMatchObject({
      done: true,
      items: [{ legacyConvexId: 'skills:one', versions: [{ legacyConvexId: 'versions:one', artifacts: [{ path: 'SKILL.md' }] }] }],
    });
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  it('persists checkpoints only after a completed page and fails report readiness closed', async () => {
    const query = vi.fn(async (sql: string) => sql.includes('SELECT COUNT(*)') ? [[{ count: 1 }], []] : [{ affectedRows: 1 }, []]);
    const checkpoint = createSkillPackageReconciliationCheckpointRepository({ query });
    await checkpoint.start({ batchId: 'batch-1', domain: 'skill' });
    await checkpoint.advance({ batchId: 'batch-1', sourceCursor: 'cursor-2', sourceCount: 1, comparedCount: 1, differenceCount: 1, sourceExhausted: false });
    const report = createSkillPackageReconciliationReportRepository({ query });

    await expect(report.persist({ batchId: 'batch-1', domain: 'skill', sourceAggregates: 1, targetAggregates: 1, comparedAggregates: 1, differences: 1 }, {
      batchId: 'batch-1', domain: 'skill', sourceCursor: 'cursor-2', pageCount: 1, sourceCount: 1,
      comparedCount: 1, differenceCount: 1, sourceExhausted: false, completed: false, failed: false,
    })).resolves.toMatchObject({ candidateReady: false, unclassifiedDifferences: 1 });
    expect(query.mock.calls.some(([sql]) => String(sql).includes('skill_package_reconciliation_checkpoints'))).toBe(true);
  });

  it('claims an expired outbox job and rejects stale completion or failure tokens', async () => {
    const claimQuery = vi.fn()
      .mockResolvedValueOnce([[{ id: 'event-1', aggregateId: 'version-1', attempts: 0, payload: JSON.stringify({
        domain: 'skill', versionLegacyConvexId: 'versions:one', artifact: {
          legacyStorageId: 'storage:one', path: 'SKILL.md', mimeType: 'text/markdown', sizeBytes: 3, sha256: 'c'.repeat(64),
        },
      }) }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const claimConnection = connection(claimQuery);
    const poolQuery = vi.fn().mockResolvedValue([{ affectedRows: 0 }, []]);
    const repository = createMysqlSkillPackageAssetCopyRepository({
      getConnection: vi.fn().mockResolvedValue(claimConnection), query: poolQuery,
    } as unknown as Pool);

    await expect(repository.claim()).resolves.toMatchObject({ id: 'event-1', sourceVerified: true, artifact: { path: 'SKILL.md' } });
    await expect(repository.complete({ id: 'event-1', claimToken: 'stale', targetAssetId: 'asset-1' })).resolves.toBe(false);
    await expect(repository.fail({ id: 'event-1', claimToken: 'stale', failureCode: 'copy_failed' })).resolves.toBe(false);
    expect(claimQuery.mock.calls[0]?.[0]).toContain('leaseExpiresAt <= NOW(3)');
    expect(claimQuery.mock.calls[1]?.[0]).toContain("artifact.copyStatus = 'copying'");
    expect(poolQuery.mock.calls[0]?.[0]).toContain('artifact.claimToken = ?');
    expect(poolQuery.mock.calls[1]?.[0]).toContain('artifact.copyStatus = IF(event.attempts + 1 >= ?');
    expect(poolQuery.mock.calls[1]?.[0]).toContain('event.attempts + 1');
  });
});