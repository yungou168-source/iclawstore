import type { Pool } from 'mysql2/promise';
import {
  inspectProfileMigrationReadiness,
  requireProfileMigrationAuthorization,
  type ProfileMigrationAuthorization,
  type ProfileMigrationPreflightReport,
} from './profileMigrationPreflight.js';

export type ProfileProcessMode = 'once' | 'loop';

const required = (value: string | undefined, name: string): string => {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
};

export const profileProcessMode = (value: string | undefined): ProfileProcessMode => {
  const mode = required(value, 'PROFILE_PROCESS_MODE');
  if (mode !== 'once' && mode !== 'loop') {
    throw new Error('PROFILE_PROCESS_MODE must be once or loop');
  }
  return mode;
};

export const boundedProfileInteger = (
  value: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
};

export const requireMysqlDatabaseUrl = (environment: NodeJS.ProcessEnv = process.env): string => {
  const databaseUrl = required(environment.DATABASE_URL, 'DATABASE_URL');
  if (!databaseUrl.startsWith('mysql')) throw new Error('DATABASE_URL must be a MySQL URL');
  return databaseUrl;
};

export const authorizeAndPreflightProfileProcess = async (
  pool: Pick<Pool, 'query'>,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<Readonly<{
  authorization: ProfileMigrationAuthorization;
  report: ProfileMigrationPreflightReport;
}>> => {
  const authorization = requireProfileMigrationAuthorization(environment);
  const report = await inspectProfileMigrationReadiness(pool);
  if (!report.ready) {
    throw new Error('Profile migration database structure is not ready');
  }
  return { authorization, report };
};

export const installProfileProcessShutdown = (): Readonly<{
  isStopping: () => boolean;
  dispose: () => void;
}> => {
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return Object.freeze({
    isStopping: () => stopping,
    dispose: () => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    },
  });
};

export const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));