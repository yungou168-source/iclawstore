import { createPool } from 'mysql2/promise';
import { createSoulRuntimeComposition } from './domains/souls/soulRuntimeComposition.js';
import { assertSoulOpsCanExecute, executeSoulOpsRequest, parseSoulOpsRequest } from './domains/souls/soulMigrationOps.js';

const request = parseSoulOpsRequest(process.argv.slice(2));
assertSoulOpsCanExecute(request);
if (request.dryRun) {
  process.stdout.write(`${JSON.stringify({ ...request, status: 'dry-run' })}\n`);
  process.exit(0);
}
const databaseUrl = process.env.SOUL_CANDIDATE_DATABASE_URL;
if (!databaseUrl?.startsWith('mysql')) throw new Error('SOUL_CANDIDATE_DATABASE_URL must be a MySQL URL');
if (process.env.DATABASE_URL) {
  throw new Error('Candidate Soul operations refuse DATABASE_URL');
}
const pool = createPool({ uri: databaseUrl, connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT ?? 4) });
try {
  const runtime = createSoulRuntimeComposition({ pool });
  const result = await executeSoulOpsRequest(request, {
    fullImport: () => runtime.registry.run('soul-full-import'),
    incrementalSync: () => runtime.registry.run('soul-incremental-sync'),
    assetCopy: () => runtime.registry.run('soul-asset-copy'),
    reconcile: () => runtime.registry.run('soul-reconcile'),
    status: async () => runtime.controlPlane.loadCheckpoint(process.env.SOUL_BATCH_ID ?? '', 'soul-full-import'),
  });
  process.stdout.write(`${JSON.stringify({ command: request.command, actor: request.actor, result })}\n`);
} finally {
  await pool.end();
}