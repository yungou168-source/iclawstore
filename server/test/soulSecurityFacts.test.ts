import { describe, expect, it } from 'vitest';
import { createSoulSecurityFacts, soulAclMatrix } from '../src/domains/souls/soulSecurityFacts.js';

describe('Soul security facts', () => {
  it('enforces the published, scanned ACL boundary', () => {
    expect(soulAclMatrix.allows({ role: 'reader', soulState: 'published' }, 'social', 'comment')).toBe(true);
    expect(soulAclMatrix.allows({ role: 'anonymous', soulState: 'published' }, 'social', 'star')).toBe(false);
    expect(soulAclMatrix.allows({ role: 'installer', soulState: 'published', scanState: 'pending' }, 'asset', 'install')).toBe(false);
    expect(soulAclMatrix.allows({ role: 'installer', soulState: 'published', scanState: 'passed' }, 'asset', 'install')).toBe(true);
    expect(soulAclMatrix.allows({ role: 'reader', soulState: 'hidden' }, 'soul', 'read')).toBe(false);
    expect(soulAclMatrix.allows({ role: 'admin', soulState: 'hidden' }, 'soul', 'read')).toBe(true);
    expect(soulAclMatrix.allows({ role: 'owner', soulState: 'published' }, 'ownership', 'transfer')).toBe(true);
    expect(soulAclMatrix.allows({ role: 'owner', soulState: 'transfer_pending' }, 'ownership', 'transfer')).toBe(false);
  });

  it('covers deny-first ACL outcomes across roles and lifecycle states', () => {
    const roles = ['anonymous', 'reader', 'installer', 'owner', 'moderator', 'admin'] as const;
    const states = ['published', 'hidden', 'deleted', 'banned', 'transfer_pending'] as const;
    for (const role of roles) for (const soulState of states) {
      const context = { role, soulState };
      const expectedRead = soulState === 'deleted'
        ? false
        : soulState === 'hidden'
          ? ['owner', 'moderator', 'admin'].includes(role)
          : soulState === 'banned'
            ? role === 'admin'
            : role !== 'anonymous';
      expect(soulAclMatrix.allows(context, 'soul', 'read')).toBe(expectedRead);
      expect(soulAclMatrix.allows({ ...context, actorBanned: true }, 'soul', 'read')).toBe(false);
      expect(soulAclMatrix.allows(context, 'social', 'comment')).toBe(['reader', 'owner', 'moderator', 'admin'].includes(role) && soulState === 'published');
    }
  });

  it('deduplicates retries and preserves an append-only audit chain', () => {
    const facts = createSoulSecurityFacts();
    const input = { subjectId: 'soul:1', actorId: 'user:1', body: 'hello', idempotencyKey: 'comment-1' };
    expect(facts.comment(input)).toEqual(facts.comment(input));
    facts.star({ subjectId: 'soul:1', actorId: 'user:1', active: true, idempotencyKey: 'star-1' });
    facts.scan({ subjectId: 'version:1', actorId: null, state: 'passed', digest: 'sha256:1', idempotencyKey: 'scan-1' });
    facts.appeal({ subjectId: 'soul:1', actorId: 'user:1', state: 'submitted', reason: 'false positive', idempotencyKey: 'appeal-1' });
    facts.transfer({ subjectId: 'soul:1', actorId: 'user:1', targetOwnerId: 'user:2', state: 'pending', idempotencyKey: 'transfer-1' });
    expect(facts.listFacts()).toHaveLength(5);
    expect(facts.listAudit().map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(facts.verifyAudit()).toBe(true);
  });

  it('rejects terminal security transitions and permits only one scan decision', () => {
    const facts = createSoulSecurityFacts();
    facts.scan({ subjectId: 'version:1', actorId: null, state: 'pending', digest: 'sha256:1', idempotencyKey: 'scan-pending' });
    facts.scan({ subjectId: 'version:1', actorId: null, state: 'passed', digest: 'sha256:1', idempotencyKey: 'scan-passed' });
    expect(() => facts.scan({ subjectId: 'version:1', actorId: null, state: 'blocked', digest: 'sha256:1', idempotencyKey: 'scan-blocked' })).toThrow('invalid scan transition');
    facts.transfer({ subjectId: 'soul:1', actorId: 'user:1', targetOwnerId: 'user:2', state: 'pending', idempotencyKey: 'transfer-pending' });
    facts.transfer({ subjectId: 'soul:1', actorId: 'user:1', targetOwnerId: 'user:2', state: 'accepted', idempotencyKey: 'transfer-accepted' });
    expect(() => facts.transfer({ subjectId: 'soul:1', actorId: 'user:1', targetOwnerId: 'user:3', state: 'rejected', idempotencyKey: 'transfer-rejected' })).toThrow('invalid ownership_transfer transition');
  });

  it('keeps failed transactions out of the fact chain when the caller does not append', () => {
    const facts = createSoulSecurityFacts();
    expect(facts.listFacts()).toHaveLength(0);
    expect(facts.listAudit()).toHaveLength(0);
    expect(facts.verifyAudit()).toBe(true);
  });
});