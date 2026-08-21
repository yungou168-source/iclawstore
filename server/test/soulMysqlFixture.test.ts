import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSoulMysqlFixture, type SoulMysqlFixture } from './fixtures/mysqlSoulFixture.js';

const enabled = Boolean(process.env.SOUL_FIXTURE_DATABASE_URL);
const suite = enabled ? describe : describe.skip;

suite('real Soul MySQL fixture', () => {
  let fixture: SoulMysqlFixture;

  beforeAll(async () => {
    fixture = await createSoulMysqlFixture();
  });

  afterAll(async () => {
    await fixture?.reset();
    await fixture?.close();
  });

  it('applies migrations and isolates candidate control-plane data', async () => {
    const [rows] = await fixture.pool.query<Array<{ name: string }>>(
      `SELECT TABLE_NAME AS name FROM information_schema.tables
       WHERE table_schema = DATABASE() AND TABLE_NAME IN
       ('soul_snapshots', 'soul_version_snapshots', 'soul_version_file_snapshots',
        'soul_migration_checkpoints', 'soul_migration_reports', 'soul_security_facts',
        'soul_security_audit_chain', 'soul_acl_grants')`,
    );
    expect(rows.map((row) => row.name).sort()).toEqual([
      'soul_acl_grants',
      'soul_migration_checkpoints',
      'soul_migration_reports',
      'soul_security_audit_chain',
      'soul_security_facts',
      'soul_snapshots',
      'soul_version_file_snapshots',
      'soul_version_snapshots',
    ]);
  });
});