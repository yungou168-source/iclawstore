import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMysqlSoulFactsRepository } from '../src/domains/souls/mysqlSoulFactsRepository.js';
import { createMysqlSoulReconciliationRunner } from '../src/domains/souls/mysqlSoulReconciliationRunner.js';
import { createSoulAssetCopyConsumer } from '../src/domains/souls/soulAssetCopyConsumer.js';
import { importSoulMigrationPage } from '../src/domains/souls/soulMigrationRuntime.js';
import { ManagedAssetStore } from '../src/services/managedAssetStore.js';
import { createMysqlSoulMigrationControlPlane } from '../src/domains/souls/mysqlSoulMigrationControlPlane.js';
import { createSoulMysqlFixture, type SoulMysqlFixture } from './fixtures/mysqlSoulFixture.js';

const execFileAsync = promisify(execFile);
const enabled = Boolean(process.env.SOUL_FIXTURE_DATABASE_URL);
const suite = enabled ? describe : describe.skip;

const makeSnapshot = (bytes: Buffer, displayName = 'Fixture Soul') => {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return {
    legacyConvexId: 'soul:fixture', slug: 'fixture-soul', displayName, summary: 'fixture',
    ownerUserLegacyConvexId: 'user:fixture', ownerPublisherLegacyConvexId: null,
    latestVersionLegacyConvexId: 'version:fixture', tags: { fixture: 'true' }, stats: {},
    legacyCreatedAt: 1_700_000_000_000, legacyUpdatedAt: 1_700_000_001_000,
    softDeletedAt: null, sourceHash: 'a'.repeat(64),
    versions: [{
      legacyConvexId: 'version:fixture', semanticVersion: '1.0.0', fingerprint: null,
      changelog: 'fixture', changelogSource: null, parsedMetadata: {},
      createdByUserLegacyConvexId: 'user:fixture', legacyCreatedAt: 1_700_000_000_000,
      softDeletedAt: null, sourceHash: 'b'.repeat(64), files: [{
        path: 'fixture.clawtemplate', mimeType: 'application/zip', sizeBytes: bytes.length,
        sha256, legacyStorageId: 'storage:fixture', targetAssetId: null,
        assetReferenceState: 'pending' as const,
      }],
    }],
  };
};

suite('real Soul import, asset and reconciliation fixture', () => {
  let fixture: SoulMysqlFixture;
  let packageBytes: Buffer;
  let managedRoot: string;

  beforeAll(async () => {
    fixture = await createSoulMysqlFixture();
    managedRoot = await mkdtemp('/tmp/soul-managed-assets-');
    const sourceRoot = await mkdtemp('/tmp/soul-package-source-');
    const manifest = {
      schemaVersion: 1, id: 'fixture-template', name: 'Fixture', description: 'fixture package',
      version: '1.0.0', entry: 'index.html', author: { name: 'Fixture', publisherId: 'fixture' },
      screenshots: ['screenshots/preview.png'], dataSchemaVersion: 1, capabilities: [],
    };
    await writeFile(`${sourceRoot}/manifest.json`, JSON.stringify(manifest));
    await writeFile(`${sourceRoot}/index.html`, '<!doctype html><title>fixture</title>');
    await mkdirSafe(`${sourceRoot}/screenshots`);
    await writeFile(`${sourceRoot}/screenshots/preview.png`, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const packagePath = `${sourceRoot}/fixture.clawtemplate`;
    await execFileAsync('zip', ['-q', '-r', packagePath, 'manifest.json', 'index.html', 'screenshots'], { cwd: sourceRoot });
    packageBytes = await readFile(packagePath);
    await rm(sourceRoot, { recursive: true, force: true });
  });

  afterAll(async () => {
    await fixture?.reset();
    await fixture?.close();
    if (managedRoot) await rm(managedRoot, { recursive: true, force: true });
  });

  it('imports snapshots, copies assets with metadata, replays idempotently, and recovers retryable failures', async () => {
    const snapshot = makeSnapshot(packageBytes);
    const repository = createMysqlSoulFactsRepository(fixture.pool);
    const source = { page: async ({ cursor }: { cursor: string | null }) => ({
      watermark: 'fixture-v1', cursor: null, exhausted: true, snapshots: cursor ? [] : [snapshot],
    }) };
    const imported = await importSoulMigrationPage({ batchId: fixture.batchId, checkpoint: null, limit: 10, source, target: {
      importPage: async ({ snapshots, checkpoint }) => {
        for (const item of snapshots) await repository.upsert(fixture.batchId, item);
        const controlPlane = createMysqlSoulMigrationControlPlane(fixture.pool);
        await controlPlane.saveCheckpoint({ batchId: fixture.batchId, jobKind: 'soul-full-import', checkpoint, imported: snapshots.length });
      },
    }});
    expect(imported.completed).toBe(true);
    expect((await repository.getByLegacyId('soul:fixture'))?.versions[0]?.files[0]?.sha256).toBe(snapshot.versions[0].files[0].sha256);

    const assetSource = { open: async (id: string) => {
      if (id !== 'storage:fixture') throw new Error('missing fixture object');
      return Readable.from(packageBytes);
    }};
    const consumer = createSoulAssetCopyConsumer({ pool: fixture.pool, source: assetSource, store: new ManagedAssetStore(managedRoot) });
    await expect(consumer.copyPending(10)).resolves.toMatchObject({ copied: 1, failed: 0 });
    await expect(consumer.copyPending(10)).resolves.toMatchObject({ copied: 0, failed: 0 });
    const [assetRows] = await fixture.pool.query<Array<{ sha256: string; sizeBytes: number; mimeType: string }>>('SELECT sha256, sizeBytes, mimeType FROM convex_exit_managed_assets WHERE legacyStorageId = ?', ['storage:fixture']);
    expect(assetRows[0]).toMatchObject({ sha256: snapshot.versions[0].files[0].sha256, sizeBytes: packageBytes.length, mimeType: 'application/zip' });

    await fixture.pool.query("UPDATE soul_version_file_snapshots SET assetReferenceState = 'pending', targetAssetId = NULL WHERE legacyStorageId = ?", ['storage:fixture']);
    let attempts = 0;
    const retrySource = { open: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary object store timeout');
      return Readable.from(packageBytes);
    }};
    const retryConsumer = createSoulAssetCopyConsumer({ pool: fixture.pool, source: retrySource, store: new ManagedAssetStore(managedRoot) });
    await expect(retryConsumer.copyPending(10)).resolves.toMatchObject({ retryable: 1 });
    await expect(retryConsumer.copyPending(10)).resolves.toMatchObject({ copied: 1 });
  });

  it('persists blocking reconciliation reports for changed and orphan targets', async () => {
    const repository = createMysqlSoulFactsRepository(fixture.pool);
    const controlPlane = createMysqlSoulMigrationControlPlane(fixture.pool);
    const base = makeSnapshot(packageBytes);
    const changed = { ...base, displayName: 'Changed fixture' };
    const changedRunner = createMysqlSoulReconciliationRunner({
      pool: fixture.pool, source: { page: async () => ({ watermark: 'fixture-v2', cursor: null, exhausted: true, snapshots: [changed] }) },
      target: repository, persistReport: controlPlane.persistReport, batchId: fixture.batchId,
    });
    await expect(changedRunner()).resolves.toMatchObject({ candidateReady: false, differenceCount: expect.any(Number) });

    const orphanRunner = createMysqlSoulReconciliationRunner({
      pool: fixture.pool, source: { page: async () => ({ watermark: 'fixture-v3', cursor: null, exhausted: true, snapshots: [] }) },
      target: repository, persistReport: controlPlane.persistReport, batchId: fixture.batchId,
    });
    await expect(orphanRunner()).resolves.toMatchObject({ candidateReady: false, differenceCount: expect.any(Number) });
  });
});

const mkdirSafe = async (path: string) => {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path, { recursive: true });
};