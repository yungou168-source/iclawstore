import { createPool } from 'mysql2/promise';
import { createCandidateFixtureRetentionRepository } from './domains/migration/candidateFixtureRetention.js';

const required = (value: string | undefined, name: string): string => {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
};

export const runCandidateFixtureRetentionRegistrationProcess = async (
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> => {
  if (environment.CANDIDATE_FIXTURE_RETENTION_REGISTRATION !== '1') {
    throw new Error('CANDIDATE_FIXTURE_RETENTION_REGISTRATION=1 is required');
  }
  const databaseUrl = required(environment.DATABASE_URL, 'DATABASE_URL');
  const domain = required(environment.CANDIDATE_FIXTURE_RETENTION_DOMAIN, 'CANDIDATE_FIXTURE_RETENTION_DOMAIN');
  if (domain !== 'profiles' && domain !== 'publishers') {
    throw new Error('CANDIDATE_FIXTURE_RETENTION_DOMAIN must be profiles or publishers');
  }
  const pool = createPool({ uri: databaseUrl, connectionLimit: 1, waitForConnections: true });
  try {
    const record = await createCandidateFixtureRetentionRepository({
      query: (sql, values) => pool.query(sql, values ? [...values] : undefined),
    }).register({
      domain,
      fixtureIdentifier: required(
        environment.CANDIDATE_FIXTURE_RETENTION_IDENTIFIER,
        'CANDIDATE_FIXTURE_RETENTION_IDENTIFIER',
      ),
      cleanupReason: required(
        environment.CANDIDATE_FIXTURE_RETENTION_REASON,
        'CANDIDATE_FIXTURE_RETENTION_REASON',
      ),
      confirmedBy: required(
        environment.CANDIDATE_FIXTURE_RETENTION_CONFIRMED_BY,
        'CANDIDATE_FIXTURE_RETENTION_CONFIRMED_BY',
      ),
      environment,
    });
    console.info(JSON.stringify({ event: 'candidate.fixture-retention.registered', record }));
  } finally {
    await pool.end();
  }
};

if (
  process.argv[1] &&
  /(?:^|\/)candidateFixtureRetentionRegistrationProcess(?:\.ts|\.js)?$/.test(process.argv[1])
) {
  await runCandidateFixtureRetentionRegistrationProcess();
}