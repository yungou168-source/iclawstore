import { randomUUID } from 'node:crypto';

export const CANDIDATE_FIXTURE_RETENTION_CONFIRMATION = 'candidate-e2e-fixtures';

type CandidateFixtureDomain = 'profiles' | 'publishers';

type FixtureDefinition = Readonly<{
  domain: CandidateFixtureDomain;
  fixtureIdentifier: 'candidate-e2e-profile' | 'candidate-e2e-org';
  fixtureMarker: string;
  snapshotTable: 'profile_snapshots' | 'publisher_snapshots';
  identifierColumn: 'profileSlug' | 'handle';
  outboxEventType: 'profiles.avatar.import-requested' | 'publishers.avatar.import-requested';
  failureCode: 'profile_avatar_source_missing' | 'publisher_avatar_source_missing';
}>;

const FIXTURES: readonly FixtureDefinition[] = Object.freeze([
  Object.freeze({
    domain: 'profiles',
    fixtureIdentifier: 'candidate-e2e-profile',
    fixtureMarker: 'candidate-e2e-profile',
    snapshotTable: 'profile_snapshots',
    identifierColumn: 'profileSlug',
    outboxEventType: 'profiles.avatar.import-requested',
    failureCode: 'profile_avatar_source_missing',
  }),
  Object.freeze({
    domain: 'publishers',
    fixtureIdentifier: 'candidate-e2e-org',
    fixtureMarker: 'candidate-e2e-org',
    snapshotTable: 'publisher_snapshots',
    identifierColumn: 'handle',
    outboxEventType: 'publishers.avatar.import-requested',
    failureCode: 'publisher_avatar_source_missing',
  }),
]);

type SqlConnection = Readonly<{
  query: (sql: string, values?: readonly unknown[]) => Promise<unknown>;
}>;

type SnapshotRow = Readonly<{ id: string; legacyConvexId: string; fixtureIdentifier: string }>;
type OutboxRow = Readonly<{ id: string; failureReason: string | null; status: string }>;
type RetentionRow = Readonly<{
  domain: CandidateFixtureDomain;
  legacyConvexId: string;
  snapshotId: string;
  fixtureIdentifier: string;
  fixtureMarker: string;
  cleanupConfirmation: string;
  outboxEventId: string;
  outboxFailureCode: string;
}>;

const rows = <T>(result: unknown): readonly T[] =>
  Array.isArray(result) && Array.isArray(result[0]) ? result[0] as T[] : [];

const required = (value: string | undefined, name: string): string => {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
};

const fixtureFor = (domain: string, fixtureIdentifier: string): FixtureDefinition => {
  const fixture = FIXTURES.find(
    (candidate) => candidate.domain === domain && candidate.fixtureIdentifier === fixtureIdentifier,
  );
  if (!fixture) throw new Error('Retention registration only permits exact retired candidate fixture identifiers');
  return fixture;
};

const requireCandidateAuthorization = (environment: NodeJS.ProcessEnv): void => {
  if (environment.CANDIDATE_E2E_FIXTURES !== '1') {
    throw new Error('CANDIDATE_E2E_FIXTURES=1 is required');
  }
  if (environment.CANDIDATE_FIXTURE_RETENTION_CONFIRMATION !== CANDIDATE_FIXTURE_RETENTION_CONFIRMATION) {
    throw new Error('CANDIDATE_FIXTURE_RETENTION_CONFIRMATION must confirm candidate-e2e-fixtures');
  }
  if (environment.PROFILE_MIGRATION_ENV === 'production' || environment.PUBLISHER_MIGRATION_ENV === 'production') {
    throw new Error('Candidate fixture retention is unavailable for production migration environments');
  }
};

export type CandidateFixtureRetention = Readonly<{
  domain: CandidateFixtureDomain;
  legacyConvexId: string;
  snapshotId: string;
  fixtureIdentifier: string;
  fixtureMarker: string;
  cleanupConfirmation: string;
  outboxEventId: string;
  outboxFailureCode: string;
}>;

export const createCandidateFixtureRetentionRepository = (connection: SqlConnection) =>
  Object.freeze({
    findExact: async (input: Readonly<{
      domain: CandidateFixtureDomain;
      legacyConvexId: string;
      fixtureIdentifier: string;
      fixtureMarker: string;
    }>): Promise<CandidateFixtureRetention | null> => {
      const [record] = rows<RetentionRow>(await connection.query(
        `SELECT domain, legacyConvexId, snapshotId, fixtureIdentifier, fixtureMarker,
                cleanupConfirmation, outboxEventId, outboxFailureCode
         FROM candidate_fixture_retention_records
         WHERE domain = ? AND legacyConvexId = ? AND fixtureIdentifier = ?
           AND fixtureMarker = ? AND cleanupConfirmation = ?
         LIMIT 1`,
        [input.domain, input.legacyConvexId, input.fixtureIdentifier, input.fixtureMarker, CANDIDATE_FIXTURE_RETENTION_CONFIRMATION],
      ));
      return record ?? null;
    },

    classifyTargetOnly: async (input: Readonly<{
      domain: CandidateFixtureDomain;
      legacyConvexId: string;
      fieldName: string;
      differenceKind: string;
      summary: string;
    }>): Promise<boolean> => {
      const fixture = FIXTURES.find((candidate) => candidate.domain === input.domain);
      if (!fixture || input.fieldName !== (fixture.domain === 'profiles' ? 'profile' : 'publisher') ||
        input.differenceKind !== 'missing' ||
        input.summary !== `source ${fixture.domain === 'profiles' ? 'profile' : 'publisher'} is absent`) return false;
      const [snapshot] = rows<SnapshotRow>(await connection.query(
        `SELECT id, legacyConvexId, ${fixture.identifierColumn} AS fixtureIdentifier
         FROM ${fixture.snapshotTable}
         WHERE legacyConvexId = ? AND ${fixture.identifierColumn} = ?
         LIMIT 1`,
        [input.legacyConvexId, fixture.fixtureIdentifier],
      ));
      if (!snapshot || snapshot.fixtureIdentifier !== fixture.fixtureIdentifier) return false;
      return Boolean(await createCandidateFixtureRetentionRepository(connection).findExact({
        domain: fixture.domain,
        legacyConvexId: snapshot.legacyConvexId,
        fixtureIdentifier: fixture.fixtureIdentifier,
        fixtureMarker: fixture.fixtureMarker,
      }));
    },

    register: async (input: Readonly<{
      domain: CandidateFixtureDomain;
      fixtureIdentifier: string;
      cleanupReason: string;
      confirmedBy: string;
      environment?: NodeJS.ProcessEnv;
    }>): Promise<CandidateFixtureRetention> => {
      requireCandidateAuthorization(input.environment ?? process.env);
      const fixture = fixtureFor(input.domain, input.fixtureIdentifier);
      const [snapshot] = rows<SnapshotRow>(await connection.query(
        `SELECT id, legacyConvexId, ${fixture.identifierColumn} AS fixtureIdentifier
         FROM ${fixture.snapshotTable}
         WHERE ${fixture.identifierColumn} = ?
         LIMIT 1`,
        [fixture.fixtureIdentifier],
      ));
      if (!snapshot || snapshot.fixtureIdentifier !== fixture.fixtureIdentifier) {
        throw new Error('Exact retired fixture snapshot is required before retention registration');
      }
      const [outbox] = rows<OutboxRow>(await connection.query(
        `SELECT id, failureReason, status
         FROM convex_exit_outbox_events
         WHERE domain = ? AND aggregateId = ? AND eventType = ?
           AND status IN ('pending', 'failed') AND failureReason = ?
         ORDER BY occurredAt ASC
         LIMIT 1`,
        [fixture.domain, snapshot.legacyConvexId, fixture.outboxEventType, fixture.failureCode],
      ));
      if (!outbox || outbox.failureReason !== fixture.failureCode) {
        throw new Error('Exact retained fixture avatar-source-missing evidence is required');
      }
      const [existing] = rows<RetentionRow>(await connection.query(
        `SELECT domain, legacyConvexId, snapshotId, fixtureIdentifier, fixtureMarker,
                cleanupConfirmation, outboxEventId, outboxFailureCode
         FROM candidate_fixture_retention_records
         WHERE domain = ? AND legacyConvexId = ?
         LIMIT 1`,
        [fixture.domain, snapshot.legacyConvexId],
      ));
      if (existing) {
        if (
          existing.snapshotId !== snapshot.id ||
          existing.fixtureIdentifier !== fixture.fixtureIdentifier ||
          existing.fixtureMarker !== fixture.fixtureMarker ||
          existing.outboxEventId !== outbox.id ||
          existing.outboxFailureCode !== fixture.failureCode
        ) throw new Error('Existing retention record conflicts with immutable historical evidence');
        return existing;
      }
      await connection.query(
        `INSERT INTO candidate_fixture_retention_records
          (id, domain, legacyConvexId, snapshotId, fixtureIdentifier, fixtureMarker,
           cleanupConfirmation, cleanupReason, outboxEventId, outboxFailureCode, confirmedBy)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), fixture.domain, snapshot.legacyConvexId, snapshot.id, fixture.fixtureIdentifier,
          fixture.fixtureMarker, CANDIDATE_FIXTURE_RETENTION_CONFIRMATION,
          required(input.cleanupReason, 'cleanup reason'), outbox.id, fixture.failureCode,
          required(input.confirmedBy, 'confirmed by')],
      );
      return {
        domain: fixture.domain,
        legacyConvexId: snapshot.legacyConvexId,
        snapshotId: snapshot.id,
        fixtureIdentifier: fixture.fixtureIdentifier,
        fixtureMarker: fixture.fixtureMarker,
        cleanupConfirmation: CANDIDATE_FIXTURE_RETENTION_CONFIRMATION,
        outboxEventId: outbox.id,
        outboxFailureCode: fixture.failureCode,
      };
    },
  });