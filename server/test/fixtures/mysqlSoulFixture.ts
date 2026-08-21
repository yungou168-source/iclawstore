import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import mysql, { type Pool } from 'mysql2/promise';

const execFileAsync = promisify(execFile);

export type SoulMysqlFixture = Readonly<{
  pool: Pool;
  batchId: string;
  reset: () => Promise<void>;
  close: () => Promise<void>;
}>;

/**
 * Opt-in integration fixture. It only uses DATABASE_URL supplied by the test
 * process and never falls back to a production or developer database.
 */
export const createSoulMysqlFixture = async (environment: NodeJS.ProcessEnv = process.env): Promise<SoulMysqlFixture> => {
  const databaseUrl = environment.SOUL_FIXTURE_DATABASE_URL ?? environment.DATABASE_URL;
  if (!databaseUrl) throw new Error('SOUL_FIXTURE_DATABASE_URL is required');
  if (environment.SOUL_FIXTURE_DATABASE_URL === undefined && environment.NODE_ENV !== 'test') {
    throw new Error('DATABASE_URL is allowed only when NODE_ENV=test');
  }

  const schemaPath = new URL('../../../prisma/schema.prisma', import.meta.url).pathname;
  await execFileAsync('bunx', ['prisma', 'migrate', 'deploy', '--schema', schemaPath], {
    cwd: new URL('../..', import.meta.url).pathname,
    env: { ...environment, DATABASE_URL: databaseUrl },
  });
  const pool = mysql.createPool(databaseUrl);
  const batchId = randomUUID();
  await pool.query(
    `INSERT INTO convex_exit_migration_batches (id, domain, source, status, requestedBy)
     VALUES (?, 'souls', 'fixture', 'running', 'test')`,
    [batchId],
  );

  const reset = async () => {
    await pool.query('DELETE FROM soul_security_audit_chain');
    await pool.query('DELETE FROM soul_security_facts');
    await pool.query('DELETE FROM soul_acl_grants');
    await pool.query('DELETE FROM soul_migration_reports WHERE batchId = ?', [batchId]);
    await pool.query('DELETE FROM soul_migration_checkpoints WHERE batchId = ?', [batchId]);
    await pool.query('DELETE FROM soul_version_file_snapshots');
    await pool.query('DELETE FROM soul_version_snapshots');
    await pool.query('DELETE FROM soul_snapshots');
    await pool.query('DELETE FROM convex_exit_managed_assets WHERE ownerDomain = \'souls\'');
  };
  const close = async () => { await pool.end(); };
  return { pool, batchId, reset, close };
};