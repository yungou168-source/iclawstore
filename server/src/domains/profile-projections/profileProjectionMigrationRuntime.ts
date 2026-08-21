import type { Pool } from 'mysql2/promise';

const required = (value: string | undefined, name: string): string => {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
};

export type ProfileProjectionMigrationAuthorization = Readonly<{
  environment: 'candidate';
  approvalRef: string;
}>;

export const requireProfileProjectionMigrationAuthorization = (
  environment: NodeJS.ProcessEnv = process.env,
): ProfileProjectionMigrationAuthorization => {
  if (environment.PROFILE_PROJECTION_MIGRATION_EXECUTION !== '1') {
    throw new Error('PROFILE_PROJECTION_MIGRATION_EXECUTION=1 is required');
  }
  if (required(environment.PROFILE_PROJECTION_MIGRATION_ENV, 'PROFILE_PROJECTION_MIGRATION_ENV') !== 'candidate') {
    throw new Error('PROFILE_PROJECTION_MIGRATION_ENV must be candidate');
  }
  if (environment.PROFILE_PROJECTION_MIGRATION_PRODUCTION_TARGET === '1') {
    throw new Error('Profile projection migration process does not support production targets');
  }
  return Object.freeze({
    environment: 'candidate',
    approvalRef: required(
      environment.PROFILE_PROJECTION_MIGRATION_APPROVAL_REF,
      'PROFILE_PROJECTION_MIGRATION_APPROVAL_REF',
    ),
  });
};

export const requireProfileProjectionMysqlDatabaseUrl = (
  environment: NodeJS.ProcessEnv = process.env,
): string => {
  const url = required(environment.DATABASE_URL, 'DATABASE_URL');
  if (!url.startsWith('mysql')) throw new Error('DATABASE_URL must be a MySQL URL');
  return url;
};

export const profileProjectionBatchSize = (value: string | undefined): number => {
  const size = Number(value ?? 100);
  if (!Number.isSafeInteger(size) || size < 1 || size > 250) {
    throw new Error('PROFILE_PROJECTION_MIGRATION_BATCH_SIZE must be an integer between 1 and 250');
  }
  return size;
};

export const requireProfileProjectionRunToCompletion = (
  environment: NodeJS.ProcessEnv = process.env,
): boolean => environment.PROFILE_PROJECTION_MIGRATION_RUN_TO_COMPLETION === '1';

export type ProfileProjectionQueryable = Pick<Pool, 'query'>;