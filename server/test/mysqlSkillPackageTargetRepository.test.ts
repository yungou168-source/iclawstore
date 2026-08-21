import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { createMysqlSkillPackageTargetRepository } from '../src/domains/skill-packages/mysqlSkillPackageTargetRepository.js';

type QueryCall = Readonly<{ sql: string; values: readonly unknown[] | undefined }>;

type FakeConnection = Readonly<{
  beginTransaction: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
  rollback: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
}>;

const aggregate = Object.freeze({
  domain: 'skill' as const,
  legacyConvexId: 'skills:one',
  ownerPublisherLegacyConvexId: 'publishers:one',
  canonicalName: 'example',
  displayName: 'Example',
  summary: 'Candidate snapshot',
  visibility: 'public' as const,
  metadata: { category: 'utility' },
  legacyUpdatedAt: 1,
  sourceHash: 'a'.repeat(64),
  versions: [
    {
      legacyConvexId: 'skillVersions:one',
      semanticVersion: '1.0.0',
      sourceHash: 'b'.repeat(64),
      sourceMetadata: { source: 'convex' },
      scanSnapshot: { status: 'passed' },
      legacyCreatedAt: 1,
      legacyUpdatedAt: 1,
      artifacts: [
        {
          legacyStorageId: 'storage:one',
          path: 'SKILL.md',
          mimeType: 'text/markdown',
          sizeBytes: 12,
          sha256: 'c'.repeat(64),
        },
      ],
    },
  ],
});

const page = Object.freeze({
  batchId: 'batch-1',
  domain: 'skill' as const,
  items: [aggregate],
  nextCursor: 'cursor-2',
  done: false,
});

const createConnection = (responses: readonly unknown[][]): FakeConnection => {
  const query = vi.fn();
  for (const response of responses) query.mockResolvedValueOnce([response, []]);
  return Object.freeze({
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    query,
  });
};

const createRepository = (connection: FakeConnection) => createMysqlSkillPackageTargetRepository({
  getConnection: vi.fn().mockResolvedValue(connection),
} as unknown as Pool);

const queryCalls = (connection: FakeConnection): readonly QueryCall[] =>
  connection.query.mock.calls.map(([sql, values]) => ({ sql: String(sql), values }));

describe('MySQL Skill/Package candidate target repository', () => {
  it('commits aggregate, legacy maps, artifact outbox and checkpoint in one transaction', async () => {
    const connection = createConnection([
      [], [], [], [], [], [{ id: 'version-1', sourceHash: aggregate.versions[0].sourceHash }], [], [], [], [], [],
    ]);

    await expect(createRepository(connection).importPage(page)).resolves.toEqual({
      upsertedCount: 1,
      unchangedCount: 0,
    });

    const calls = queryCalls(connection);
    const checkpointIndex = calls.findIndex(({ sql }) => sql.includes('UPDATE convex_exit_migration_batches'));
    const outboxIndex = calls.findIndex(({ sql }) => sql.includes('INSERT INTO convex_exit_outbox_events'));
    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
    expect(outboxIndex).toBeGreaterThan(-1);
    expect(checkpointIndex).toBeGreaterThan(outboxIndex);
    const artifactUpsert = calls.find(({ sql }) => sql.includes('INSERT INTO skill_package_artifact_snapshots'));
    expect(artifactUpsert?.sql).toContain('path = VALUES(path)');
    expect(artifactUpsert?.sql).toContain('sha256 = VALUES(sha256)');
    expect(calls[outboxIndex]!.values?.[4]).toBe('skill-package:skill:skillVersions:one:' + 'c'.repeat(64));
    expect(calls[checkpointIndex]!.values).toEqual(['cursor-2', false, 1, 0, false, 'batch-1']);
  });

  it('rolls back without advancing the checkpoint on immutable legacy-map conflict', async () => {
    const connection = createConnection([
      [{ id: 'snapshot-1', sourceHash: 'different' }],
      [{ targetId: 'other-snapshot' }],
    ]);

    await expect(createRepository(connection).importPage(page)).rejects.toThrow('Legacy Convex ID maps to a different target ID');

    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();
    expect(queryCalls(connection).some(({ sql }) => sql.includes('UPDATE convex_exit_migration_batches'))).toBe(false);
  });

  it('does not enqueue a new asset-copy event for an unchanged aggregate retry', async () => {
    const connection = createConnection([
      [{ id: 'snapshot-1', sourceHash: aggregate.sourceHash }],
      [],
      [],
    ]);

    await expect(createRepository(connection).importPage(page)).resolves.toEqual({
      upsertedCount: 0,
      unchangedCount: 1,
    });

    const calls = queryCalls(connection);
    expect(calls.some(({ sql }) => sql.includes('INSERT INTO convex_exit_outbox_events'))).toBe(false);
    expect(calls.some(({ sql }) => sql.includes('UPDATE skill_package_snapshots SET lastSeenBatchId'))).toBe(true);
    expect(connection.commit).toHaveBeenCalledOnce();
  });
});