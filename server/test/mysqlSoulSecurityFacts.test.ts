import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMysqlSoulSecurityFactsRepository } from '../src/domains/souls/mysqlSoulSecurityFactsRepository.js';
import { createSoulMysqlFixture, type SoulMysqlFixture } from './fixtures/mysqlSoulFixture.js';

const enabled = Boolean(process.env.SOUL_FIXTURE_DATABASE_URL);
const suite = enabled ? describe : describe.skip;

suite('MySQL Soul security facts', () => {
  let fixture: SoulMysqlFixture;

  beforeAll(async () => { fixture = await createSoulMysqlFixture(); });
  afterAll(async () => { await fixture?.reset(); await fixture?.close(); });

  it('commits facts and audit once when the same request is retried concurrently', async () => {
    const repository = createMysqlSoulSecurityFactsRepository(fixture.pool);
    const input = { factKind: 'comment' as const, subjectLegacyId: 'soul:1', actorLegacyId: 'user:1', state: 'active', payload: { body: 'hello' }, idempotencyKey: 'comment:1' };
    const results = await Promise.all([repository.append(input), repository.append(input)]);
    expect(results[0].id).toBe(results[1].id);
    const [facts] = await fixture.pool.query<Array<{ count: number }>>('SELECT COUNT(*) AS count FROM soul_security_facts WHERE idempotencyKey = ?', [input.idempotencyKey]);
    const [audit] = await fixture.pool.query<Array<{ count: number }>>('SELECT COUNT(*) AS count FROM soul_security_audit_chain WHERE idempotencyKey = ?', [input.idempotencyKey]);
    expect(facts[0].count).toBe(1);
    expect(audit[0].count).toBe(1);
    await expect(repository.verifyAuditChain()).resolves.toBe(true);
  });

  it('rejects an illegal state transition and rolls the transaction back', async () => {
    const repository = createMysqlSoulSecurityFactsRepository(fixture.pool);
    await repository.append({ factKind: 'appeal', subjectLegacyId: 'soul:2', actorLegacyId: 'user:2', state: 'submitted', payload: { reason: 'review' }, idempotencyKey: 'appeal:1' });
    await repository.append({ factKind: 'appeal', subjectLegacyId: 'soul:2', actorLegacyId: 'user:2', state: 'accepted', payload: {}, idempotencyKey: 'appeal:2' });
    await expect(repository.append({ factKind: 'appeal', subjectLegacyId: 'soul:2', actorLegacyId: 'user:2', state: 'rejected', payload: {}, idempotencyKey: 'appeal:3' })).rejects.toThrow('invalid appeal transition');
    const [rows] = await fixture.pool.query<Array<{ count: number }>>('SELECT COUNT(*) AS count FROM soul_security_facts WHERE subjectLegacyId = ?', ['soul:2']);
    expect(rows[0].count).toBe(2);
  });

  it('applies deny before allow in the database ACL lookup', async () => {
    const repository = createMysqlSoulSecurityFactsRepository(fixture.pool);
    await repository.grantAcl({ soulLegacyId: 'soul:3', subjectLegacyId: '*', role: 'reader', resource: 'social', action: 'comment', effect: 'allow' });
    await repository.grantAcl({ soulLegacyId: 'soul:3', subjectLegacyId: 'user:3', role: 'reader', resource: 'social', action: 'comment', effect: 'deny', reason: 'banned' });
    await expect(repository.isAllowed({ soulLegacyId: 'soul:3', subjectLegacyId: 'user:3', role: 'reader', resource: 'social', action: 'comment' })).resolves.toBe(false);
  });
});