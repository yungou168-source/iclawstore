import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { SoulAction, SoulResource, SoulRole } from './soulSecurityFacts.js';

type FactRow = RowDataPacket & { id: string; factKind: string; subjectLegacyId: string; actorLegacyId: string | null; state: string; payload: string; idempotencyKey: string };
type AuditRow = RowDataPacket & { eventHash: string; sequenceNo: number };
type GrantRow = RowDataPacket & { effect: 'allow' | 'deny' };

type FactInput = Readonly<{
  factKind: 'comment' | 'star' | 'scan' | 'appeal' | 'ownership_transfer';
  subjectLegacyId: string;
  actorLegacyId: string | null;
  state: string;
  payload: Readonly<Record<string, unknown>>;
  idempotencyKey: string;
}>;

const json = (value: unknown) => JSON.stringify(value);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

const assertTransition = (kind: FactInput['factKind'], previous: string | null, next: string) => {
  const allowed: Record<FactInput['factKind'], readonly string[]> = {
    comment: ['active', 'removed'], star: ['active', 'removed'], scan: ['pending', 'passed', 'blocked'],
    appeal: ['submitted', 'accepted', 'rejected'], ownership_transfer: ['pending', 'accepted', 'rejected', 'cancelled'],
  };
  if (!allowed[kind].includes(next)) throw new Error(`invalid ${kind} state`);
  if (previous === null) return;
  const transitions: Record<FactInput['factKind'], Record<string, readonly string[]>> = {
    comment: { active: ['removed'], removed: [] },
    star: { active: ['removed'], removed: [] },
    scan: { pending: ['passed', 'blocked'], passed: [], blocked: [] },
    appeal: { submitted: ['accepted', 'rejected'], accepted: [], rejected: [] },
    ownership_transfer: { pending: ['accepted', 'rejected', 'cancelled'], accepted: [], rejected: [], cancelled: [] },
  };
  if (!transitions[kind][previous]?.includes(next)) throw new Error(`invalid ${kind} transition: ${previous} -> ${next}`);
};

const latestFact = async (connection: PoolConnection, input: FactInput) => {
  const [rows] = await connection.query<FactRow[]>(
    'SELECT id, factKind, subjectLegacyId, actorLegacyId, state, payload, idempotencyKey FROM soul_security_facts WHERE factKind = ? AND subjectLegacyId = ? ORDER BY createdAt DESC, id DESC LIMIT 1 FOR UPDATE',
    [input.factKind, input.subjectLegacyId],
  );
  return rows[0] ?? null;
};

export const createMysqlSoulSecurityFactsRepository = (pool: Pool) => Object.freeze({
  async append(input: FactInput) {
    const connection = await pool.getConnection();
    const lockName = `soul-security:${input.idempotencyKey}`;
    let lockAcquired = false;
    try {
      const [lockRows] = await connection.query<Array<RowDataPacket & { acquired: number }>>('SELECT GET_LOCK(?, 10) AS acquired', [lockName]);
      lockAcquired = lockRows[0]?.acquired === 1;
      if (!lockAcquired) throw new Error('could not acquire Soul security idempotency lock');
      await connection.beginTransaction();
      const [existingRows] = await connection.query<FactRow[]>('SELECT id, factKind, subjectLegacyId, actorLegacyId, state, payload, idempotencyKey FROM soul_security_facts WHERE idempotencyKey = ? LIMIT 1 FOR UPDATE', [input.idempotencyKey]);
      if (existingRows[0]) {
        await connection.commit();
        return existingRows[0];
      }
      const previous = await latestFact(connection, input);
      assertTransition(input.factKind, previous?.state ?? null, input.state);
      const id = randomUUID();
      const payload = json(input.payload);
      await connection.query('INSERT INTO soul_security_facts (id, factKind, subjectLegacyId, actorLegacyId, state, payload, idempotencyKey) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, input.factKind, input.subjectLegacyId, input.actorLegacyId, input.state, payload, input.idempotencyKey]);
      const [auditRows] = await connection.query<AuditRow[]>('SELECT eventHash, sequenceNo FROM soul_security_audit_chain ORDER BY sequenceNo DESC LIMIT 1 FOR UPDATE');
      const previousHash = auditRows[0]?.eventHash ?? null;
      const eventHash = hash(json({ id, factKind: input.factKind, subjectLegacyId: input.subjectLegacyId, actorLegacyId: input.actorLegacyId, state: input.state, payload, idempotencyKey: input.idempotencyKey, previousHash }));
      await connection.query('INSERT INTO soul_security_audit_chain (eventId, factId, action, subjectLegacyId, actorLegacyId, idempotencyKey, previousHash, eventHash, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [randomUUID(), id, input.factKind, input.subjectLegacyId, input.actorLegacyId, input.idempotencyKey, previousHash, eventHash, payload]);
      await connection.commit();
      return { id, ...input };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      if (lockAcquired) await connection.query('SELECT RELEASE_LOCK(?)', [lockName]);
      connection.release();
    }
  },
  async grantAcl(input: Readonly<{ soulLegacyId: string; subjectLegacyId: string; role: SoulRole; resource: SoulResource; action: SoulAction; effect: 'allow' | 'deny'; reason?: string }>) {
    await pool.query('INSERT INTO soul_acl_grants (id, soulLegacyId, subjectLegacyId, role, resource, action, effect, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE effect=VALUES(effect), reason=VALUES(reason)', [randomUUID(), input.soulLegacyId, input.subjectLegacyId, input.role, input.resource, input.action, input.effect, input.reason ?? null]);
  },
  async isAllowed(input: Readonly<{ soulLegacyId: string; subjectLegacyId: string; role: SoulRole; resource: SoulResource; action: SoulAction }>) {
    const [rows] = await pool.query<GrantRow[]>('SELECT effect FROM soul_acl_grants WHERE soulLegacyId = ? AND (subjectLegacyId = ? OR subjectLegacyId = \'*\') AND role = ? AND resource = ? AND action = ? AND (expiresAt IS NULL OR expiresAt > NOW(3)) ORDER BY effect = \'deny\' DESC', [input.soulLegacyId, input.subjectLegacyId, input.role, input.resource, input.action]);
    return rows[0]?.effect === 'allow';
  },
  async verifyAuditChain() {
    const [rows] = await pool.query<Array<AuditRow & { previousHash: string | null }>>('SELECT sequenceNo, eventHash, previousHash FROM soul_security_audit_chain ORDER BY sequenceNo');
    return rows.every((row, index) => row.sequenceNo > (index === 0 ? 0 : rows[index - 1]!.sequenceNo) && row.previousHash === (index === 0 ? null : rows[index - 1]?.eventHash));
  },
});

export type MysqlSoulSecurityFactsRepository = ReturnType<typeof createMysqlSoulSecurityFactsRepository>;