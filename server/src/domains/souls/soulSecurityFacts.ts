export type SoulRole = 'anonymous' | 'reader' | 'installer' | 'owner' | 'moderator' | 'admin';
export type SoulResource = 'soul' | 'social' | 'asset' | 'moderation' | 'appeal' | 'ownership';
export type SoulAction = 'read' | 'comment' | 'star' | 'install' | 'moderate' | 'appeal' | 'transfer';

export type SoulAclContext = Readonly<{
  role: SoulRole;
  soulState: 'published' | 'hidden' | 'deleted' | 'banned' | 'transfer_pending';
  actorBanned?: boolean;
  scanState?: 'pending' | 'passed' | 'blocked';
}>;

const allow = (context: SoulAclContext, resource: SoulResource, action: SoulAction): boolean => {
  if (context.actorBanned) return false;
  if (context.soulState === 'deleted') return false;
  if (context.soulState === 'banned' && context.role !== 'admin') return false;
  if (context.soulState === 'hidden' && !['owner', 'moderator', 'admin'].includes(context.role)) return false;
  if (resource === 'asset' && action === 'install' && context.scanState !== 'passed') return false;
  if (resource === 'ownership' && action === 'transfer') return ['owner', 'admin'].includes(context.role) && context.soulState !== 'transfer_pending';
  if (resource === 'appeal' && action === 'appeal') return ['reader', 'owner', 'moderator', 'admin'].includes(context.role);
  if (resource === 'moderation' && action === 'moderate') return ['moderator', 'admin'].includes(context.role);
  if (resource === 'social' && ['comment', 'star'].includes(action)) return ['reader', 'owner', 'moderator', 'admin'].includes(context.role) && context.soulState === 'published';
  if (action === 'read') return ['reader', 'installer', 'owner', 'moderator', 'admin'].includes(context.role);
  if (action === 'install') return ['installer', 'owner', 'moderator', 'admin'].includes(context.role);
  return false;
};

export const soulAclMatrix = Object.freeze({
  allows: allow,
  explain: (context: SoulAclContext, resource: SoulResource, action: SoulAction) => ({
    allowed: allow(context, resource, action),
    reason: allow(context, resource, action) ? 'allowed' : 'denied_by_soul_policy',
  }),
});

export type SoulSecurityFact = Readonly<{
  id: string;
  kind: 'comment' | 'star' | 'scan' | 'appeal' | 'ownership_transfer';
  subjectId: string;
  actorId: string | null;
  state: string;
  payload: Readonly<Record<string, unknown>>;
  idempotencyKey: string;
}>;

export type SoulAuditEvent = Readonly<{
  sequence: number;
  eventId: string;
  previousHash: string | null;
  eventHash: string;
  action: string;
  subjectId: string;
  actorId: string | null;
  idempotencyKey: string;
  payload: Readonly<Record<string, unknown>>;
}>;

const assertFactTransition = (kind: SoulSecurityFact['kind'], previous: string | null, next: string): void => {
  const states: Record<SoulSecurityFact['kind'], readonly string[]> = {
    comment: ['active', 'removed'], star: ['active', 'removed'], scan: ['pending', 'passed', 'blocked'],
    appeal: ['submitted', 'accepted', 'rejected'], ownership_transfer: ['pending', 'accepted', 'rejected', 'cancelled'],
  };
  if (!states[kind].includes(next)) throw new Error(`invalid ${kind} state`);
  if (previous === null) return;
  const transitions: Record<string, readonly string[]> = {
    'comment:active': ['removed'], 'star:active': ['removed'],
    'scan:pending': ['passed', 'blocked'], 'appeal:submitted': ['accepted', 'rejected'],
    'ownership_transfer:pending': ['accepted', 'rejected', 'cancelled'],
  };
  if (!transitions[`${kind}:${previous}`]?.includes(next)) throw new Error(`invalid ${kind} transition: ${previous} -> ${next}`);
};

const digest = (value: unknown) => JSON.stringify(value, Object.keys(value as object).sort());

export const createSoulSecurityFacts = () => {
  const facts = new Map<string, SoulSecurityFact>();
  const audit: SoulAuditEvent[] = [];
  let nextSequence = 1;

  const append = (fact: Omit<SoulSecurityFact, 'id'>) => {
    const existing = facts.get(fact.idempotencyKey);
    if (existing) return existing;
    const id = `${fact.kind}:${fact.subjectId}:${fact.idempotencyKey}`;
    const previous = [...facts.values()].reverse().find((candidate) => candidate.kind === fact.kind && candidate.subjectId === fact.subjectId);
    assertFactTransition(fact.kind, previous?.state ?? null, fact.state);
    const stored = Object.freeze({ ...fact, id });
    facts.set(fact.idempotencyKey, stored);
    const previousHash = audit.at(-1)?.eventHash ?? null;
    const eventHash = digest({ sequence: nextSequence, previousHash, ...stored });
    audit.push(Object.freeze({ sequence: nextSequence, eventId: `audit:${nextSequence}`, previousHash, eventHash, action: fact.kind, subjectId: fact.subjectId, actorId: fact.actorId, idempotencyKey: fact.idempotencyKey, payload: fact.payload }));
    nextSequence += 1;
    return stored;
  };

  return Object.freeze({
    comment: (input: { subjectId: string; actorId: string; body: string; idempotencyKey: string }) => append({ kind: 'comment', subjectId: input.subjectId, actorId: input.actorId, state: 'active', payload: { body: input.body }, idempotencyKey: input.idempotencyKey }),
    star: (input: { subjectId: string; actorId: string; active: boolean; idempotencyKey: string }) => append({ kind: 'star', subjectId: input.subjectId, actorId: input.actorId, state: input.active ? 'active' : 'removed', payload: {}, idempotencyKey: input.idempotencyKey }),
    scan: (input: { subjectId: string; actorId: string | null; state: 'pending' | 'passed' | 'blocked'; digest: string; idempotencyKey: string }) => append({ kind: 'scan', subjectId: input.subjectId, actorId: input.actorId, state: input.state, payload: { digest: input.digest }, idempotencyKey: input.idempotencyKey }),
    appeal: (input: { subjectId: string; actorId: string; state: 'submitted' | 'accepted' | 'rejected'; reason: string; idempotencyKey: string }) => append({ kind: 'appeal', subjectId: input.subjectId, actorId: input.actorId, state: input.state, payload: { reason: input.reason }, idempotencyKey: input.idempotencyKey }),
    transfer: (input: { subjectId: string; actorId: string; targetOwnerId: string; state: 'pending' | 'accepted' | 'rejected' | 'cancelled'; idempotencyKey: string }) => append({ kind: 'ownership_transfer', subjectId: input.subjectId, actorId: input.actorId, state: input.state, payload: { targetOwnerId: input.targetOwnerId }, idempotencyKey: input.idempotencyKey }),
    listFacts: () => [...facts.values()],
    listAudit: () => [...audit],
    verifyAudit: () => audit.every((event, index) => event.sequence === index + 1 && event.previousHash === (index === 0 ? null : audit[index - 1]?.eventHash)),
  });
};