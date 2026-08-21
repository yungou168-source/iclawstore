import { describe, expect, it } from 'vitest';
import {
  createCandidateFixtureRetentionRepository,
  CANDIDATE_FIXTURE_RETENTION_CONFIRMATION,
} from './candidateFixtureRetention.js';

type Call = Readonly<{ sql: string; values?: readonly unknown[] }>;

const candidateEnvironment = Object.freeze({
  CANDIDATE_E2E_FIXTURES: '1',
  CANDIDATE_FIXTURE_RETENTION_CONFIRMATION,
});

const createConnection = (responses: unknown[]) => {
  const calls: Call[] = [];
  return {
    calls,
    connection: {
      query: async (sql: string, values?: readonly unknown[]) => {
        calls.push({ sql, values });
        return responses.shift() ?? [[], undefined];
      },
    },
  };
};

describe('candidate fixture retention repository', () => {
  it('registers only the exact retained profile fixture with existing historical evidence', async () => {
    const { connection, calls } = createConnection([
      [[{ id: 'snapshot-1', legacyConvexId: 'legacy-profile', fixtureIdentifier: 'candidate-e2e-profile' }]],
      [[{ id: 'outbox-1', failureReason: 'profile_avatar_source_missing', status: 'pending' }]],
      [[]],
      [[], undefined],
    ]);
    const record = await createCandidateFixtureRetentionRepository(connection).register({
      domain: 'profiles',
      fixtureIdentifier: 'candidate-e2e-profile',
      cleanupReason: 'Convex fixture was explicitly cleaned after candidate verification',
      confirmedBy: 'candidate-operator',
      environment: candidateEnvironment,
    });

    expect(record).toMatchObject({
      domain: 'profiles',
      legacyConvexId: 'legacy-profile',
      snapshotId: 'snapshot-1',
      outboxEventId: 'outbox-1',
      outboxFailureCode: 'profile_avatar_source_missing',
    });
    expect(calls.at(-1)?.sql).toContain('INSERT INTO candidate_fixture_retention_records');
    expect(calls.at(-1)?.values?.slice(-4)).toEqual([
      'Convex fixture was explicitly cleaned after candidate verification',
      'outbox-1',
      'profile_avatar_source_missing',
      'candidate-operator',
    ]);
  });

  it('fails closed for a current or unknown fixture identifier', async () => {
    const { connection } = createConnection([]);
    await expect(createCandidateFixtureRetentionRepository(connection).register({
      domain: 'profiles',
      fixtureIdentifier: 'candidate-e2e-profile-r20260314a',
      cleanupReason: 'not applicable',
      confirmedBy: 'candidate-operator',
      environment: candidateEnvironment,
    })).rejects.toThrow('only permits exact retired candidate fixture identifiers');
  });

  it('requires candidate confirmation before it reads migration evidence', async () => {
    const { connection, calls } = createConnection([]);
    await expect(createCandidateFixtureRetentionRepository(connection).register({
      domain: 'publishers',
      fixtureIdentifier: 'candidate-e2e-org',
      cleanupReason: 'not applicable',
      confirmedBy: 'candidate-operator',
      environment: {},
    })).rejects.toThrow('CANDIDATE_E2E_FIXTURES=1 is required');
    expect(calls).toHaveLength(0);
  });
});