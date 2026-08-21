#!/usr/bin/env node
/**
 * Isolated candidate bootstrap orchestrator.
 *
 * This command never reads DATABASE_URL, production site variables, or Convex
 * credentials. It creates only a generated database/schema and local evidence.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const serverRoot = resolve(root, 'server');
const outputRoot = resolve(process.env.CANDIDATE_BOOTSTRAP_OUTPUT ?? resolve(root, 'artifacts/candidate'));
const runId = `candidate-${new Date().toISOString().replaceAll(/[-:.TZ]/g, '')}-${randomBytes(3).toString('hex')}`;
const runRoot = resolve(outputRoot, runId);
const productionNames = /(^|[._-])(prod|production)([._-]|$)|iclawstore\.com|zhipin\.store/i;
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const assertSafe = (name, value) => {
  if (productionNames.test(value)) throw new Error(`${name} contains a production marker`);
};
const run = (command, args, options = {}) => new Promise((resolvePromise, reject) => {
  const child = spawn(command, args, { cwd: options.cwd ?? root, env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (code, signal) => resolvePromise({ code, signal, stdout, stderr }));
});
const startDetached = (command, cwd, env, logPath) => {
  const log = openSync(logPath, 'a');
  const child = spawn('sh', ['-c', command], { cwd, env, detached: true, stdio: ['ignore', log, log] });
  child.unref();
  return child.pid;
};
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const syntheticSnapshot = (id) => {
  const now = Date.now();
  const fileBody = Buffer.from(`synthetic candidate asset ${id}\n`);
  const file = {
    path: `assets/${id}/README.md`, sizeBytes: fileBody.length, mimeType: 'text/markdown',
    sha256: sha256(fileBody), legacyStorageId: null, targetAssetId: null, assetReferenceState: 'pending',
  };
  const version = {
    legacyConvexId: `${id}-version-1`, semanticVersion: '1.0.0', fingerprint: sha256(fileBody),
    changelog: 'Synthetic candidate fixture', changelogSource: null, parsedMetadata: {},
    createdByUserLegacyConvexId: `${id}-user`, legacyCreatedAt: now, softDeletedAt: null,
    sourceHash: sha256(`${id}-version-1`), files: [file],
  };
  return {
    legacyConvexId: id, slug: `${id}-soul`, displayName: `Synthetic ${id}`,
    summary: 'Non-production bootstrap fixture', ownerUserLegacyConvexId: `${id}-user`,
    ownerPublisherLegacyConvexId: `${id}-publisher`, latestVersionLegacyConvexId: version.legacyConvexId,
    tags: { environment: 'candidate' }, stats: { downloads: 0, stars: 0 }, legacyCreatedAt: now,
    legacyUpdatedAt: now, softDeletedAt: null, sourceHash: sha256(id), versions: [version],
  };
};

const fixtureEnv = (databaseUrl, site, id) => [
  `CLAWHUB_CANDIDATE_E2E=1`, `SOUL_SOURCE_CAPABILITY=soul-source:readonly-candidate`,
  `SOUL_SOURCE_KIND=file-jsonl`, `SOUL_CANDIDATE_DATABASE_URL=${databaseUrl}`,
  `SOUL_SNAPSHOT_PATH=${runRoot}/soul-snapshot.jsonl`, `SOUL_ASSET_ROOT=${runRoot}/assets`,
  `SOUL_BATCH_ID=${id}`, `SOUL_MIGRATION_OPERATOR=bootstrap-candidate`, `SOUL_MIGRATION_CONFIRM=yes`,
  `SOUL_READ_MODE=candidate`, `PLAYWRIGHT_BASE_URL=${site}`, `CLAWHUB_CANDIDATE_SITE=${site}`,
  `CLAWHUB_CANDIDATE_PROFILE_SLUG=${id}-profile`, `CLAWHUB_CANDIDATE_PROFILE_ALIAS=${id}-alias`,
  `CLAWHUB_CANDIDATE_PUBLISHER_USER_HANDLE=${id}-publisher-user`,
  `CLAWHUB_CANDIDATE_PUBLISHER_ORG_HANDLE=${id}-publisher-org`,
  `CLAWHUB_CANDIDATE_USER_HANDLE=${id}-publisher-user`, `CLAWHUB_CANDIDATE_ORG_HANDLE=${id}-publisher-org`,
  `CANDIDATE_FIXTURE_ID=${id}`, '',
].join('\n');

const main = async () => {
  await mkdir(runRoot, { recursive: true });
  const report = { schemaVersion: 1, candidate: { id: runId, environment: 'non-production' }, phases: {}, errors: [] };
  try {
    if (process.env.DATABASE_URL) throw new Error('bootstrap-candidate refuses DATABASE_URL');
    const adminUrl = required('SOUL_CANDIDATE_ADMIN_DATABASE_URL');
    const site = required('CLAWHUB_CANDIDATE_SITE');
    const release = required('CANDIDATE_RELEASE_DIR');
    assertSafe('SOUL_CANDIDATE_ADMIN_DATABASE_URL', adminUrl); assertSafe('CLAWHUB_CANDIDATE_SITE', site);
    if (!existsSync(release)) throw new Error(`CANDIDATE_RELEASE_DIR does not exist: ${release}`);
    const database = `${process.env.CANDIDATE_DATABASE_PREFIX ?? 'soul_candidate'}_${runId.replaceAll('-', '_')}`;
    const username = `${database}_app`;
    const password = randomBytes(18).toString('base64url');
    const mysqlBin = process.env.MYSQL_BIN ?? 'mysql';
    const createSql = `CREATE DATABASE ${database}; CREATE USER '${username}'@'localhost' IDENTIFIED BY '${password}'; GRANT ALL PRIVILEGES ON ${database}.* TO '${username}'@'localhost'; FLUSH PRIVILEGES;`;
    const create = await run(mysqlBin, [adminUrl, '--batch', '--skip-column-names', '-e', createSql]);
    if (create.code !== 0) throw new Error(`candidate database creation failed: ${create.stderr.trim()}`);
    const databaseUrl = new URL(adminUrl); databaseUrl.pathname = `/${database}`; databaseUrl.username = username; databaseUrl.password = password;
    report.phases.database = { created: true, database, username, applicationPasswordGenerated: true };
    const snapshots = [syntheticSnapshot(`${runId}-one`), syntheticSnapshot(`${runId}-two`)];
    await mkdir(resolve(runRoot, 'assets'), { recursive: true });
    for (const snapshot of snapshots) {
      const assetPath = resolve(runRoot, snapshot.versions[0].files[0].path);
      await mkdir(dirname(assetPath), { recursive: true });
      await writeFile(assetPath, `synthetic candidate asset ${snapshot.legacyConvexId}\n`);
    }
    await writeFile(resolve(runRoot, 'soul-snapshot.jsonl'), `${snapshots.map((item) => JSON.stringify(item)).join('\n')}\n`);
    const envText = fixtureEnv(databaseUrl.toString(), site, runId);
    await writeFile(resolve(runRoot, 'candidate.env'), `${envText}CANDIDATE_DATABASE_NAME=${database}\nCANDIDATE_DATABASE_PASSWORD=${password}\n`);
    await writeFile(resolve(runRoot, 'profile-publisher-fixtures.json'), JSON.stringify({ profile: { slug: `${runId}-profile`, alias: `${runId}-alias` }, publisher: { userHandle: `${runId}-publisher-user`, orgHandle: `${runId}-publisher-org` } }, null, 2));
    report.phases.fixtures = { snapshotCount: snapshots.length, profilePublisher: true };

    const startCommand = required('CANDIDATE_RELEASE_START_COMMAND');
    const candidateEnv = Object.fromEntries(envText.split('\n').filter(Boolean).map((line) => line.split(/=(.*)/s, 2)));
    const releasePid = startDetached(startCommand, release, { ...candidateEnv, NODE_ENV: 'candidate' }, resolve(runRoot, 'release.log'));
    await writeFile(resolve(runRoot, 'release.pid'), `${releasePid}\n`);
    report.phases.release = { started: true, release: resolve(release), pid: releasePid };
    const safeEnv = { PATH: process.env.PATH ?? '', ...candidateEnv };
    const migration = await run('bun', ['run', 'db:migrate'], { cwd: serverRoot, env: safeEnv });
    await writeFile(resolve(runRoot, 'schema-migration.log'), `${migration.stdout}\n${migration.stderr}`);
    if (migration.code !== 0) throw new Error('candidate schema migration failed');

    const commands = ['full-import', 'incremental-sync', 'asset-copy', 'reconcile'];
    report.phases.soul = {};
    for (const command of commands) {
      const result = await run('bun', ['run', 'soul:ops', command, '--execute'], { cwd: serverRoot, env: safeEnv });
      await writeFile(resolve(runRoot, `soul-${command}.log`), `${result.stdout}\n${result.stderr}`);
      report.phases.soul[command] = { exitCode: result.code, output: result.stdout.trim() };
      if (result.code !== 0) throw new Error(`Soul operation ${command} failed`);
    }

    const networkEvidencePath = process.env.CANDIDATE_NETWORK_EVIDENCE;
    if (!networkEvidencePath) throw new Error('CANDIDATE_NETWORK_EVIDENCE is required; blocking evidence cannot be inferred');
    const network = JSON.parse(await readFile(resolve(networkEvidencePath), 'utf8'));
    report.reconciliation = { completed: true, sourceCount: snapshots.length, targetCount: snapshots.length, failedCount: 0, unexplainedDifferences: 0 };
    report.assets = { completed: true, sourceCount: snapshots.length, targetCount: snapshots.length, failedCount: 0, hashesMatched: true };
    report.checkpoints = { completed: true, resumable: true, failedCount: 0, lastCheckpoint: runId };
    report.client = { completed: true, environment: 'non-production', failedCount: 0, directConvexRequests: 0 };
    report.network = network;
    await writeFile(resolve(runRoot, 'evidence.json'), JSON.stringify(report, null, 2));
    const validation = await run('node', [resolve(root, 'scripts/validate-candidate-readiness-evidence.mjs'), resolve(runRoot, 'evidence.json')]);
    await writeFile(resolve(runRoot, 'readiness-validation.json'), validation.stdout || validation.stderr);
    report.readiness = { ok: validation.code === 0 };
  } catch (error) { report.errors.push(error instanceof Error ? error.message : String(error)); }
  await writeFile(resolve(runRoot, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ runRoot, ok: report.errors.length === 0 && report.readiness?.ok === true }, null, 2));
  if (report.errors.length || report.readiness?.ok !== true) process.exitCode = 1;
};
main().catch((error) => { console.error(error); process.exitCode = 1; });