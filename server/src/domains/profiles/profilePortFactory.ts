import { ConvexHttpClient } from 'convex/browser';
import type { Pool } from 'mysql2/promise';
import { createComparePublicProfileAdapter, createMysqlProfileDifferenceSink } from './comparePublicProfileAdapter.js';
import { createConvexPublicProfileAdapter } from './convexPublicProfileAdapter.js';
import { createMysqlPublicProfileAdapter } from './mysqlPublicProfileAdapter.js';
import type { PublicProfilePort } from './publicProfilePort.js';

export type ProfileReadMode = 'convex' | 'compare' | 'mysql';

export const profileReadModeFromEnvironment = (
  env: NodeJS.ProcessEnv = process.env,
): ProfileReadMode => {
  const value = env.PROFILE_READ_MODE?.trim().toLowerCase();
  return value === 'compare' || value === 'mysql' || value === 'convex' ? value : 'convex';
};

export const createMysqlFallbackPublicProfileAdapter = (
  mysql: PublicProfilePort,
  convex: PublicProfilePort,
): PublicProfilePort =>
  Object.freeze({
    getBySlug: async (slug) => {
      try {
        return (await mysql.getBySlug(slug)) ?? (await convex.getBySlug(slug));
      } catch {
        return convex.getBySlug(slug);
      }
    },
  });

export const createProfilePortForMode = (input: Readonly<{
  mode: ProfileReadMode;
  convex: PublicProfilePort;
  mysql?: PublicProfilePort;
  sink?: ReturnType<typeof createMysqlProfileDifferenceSink>;
  log?: Pick<Console, 'warn'>;
}>): PublicProfilePort => {
  if (!input.mysql || input.mode === 'convex') return input.convex;
  if (input.mode === 'mysql') return createMysqlFallbackPublicProfileAdapter(input.mysql, input.convex);
  if (!input.sink) throw new Error('Profile difference sink is required for compare mode');
  return createComparePublicProfileAdapter(input.convex, input.mysql, input.sink, input.log);
};

export const createPublicProfilePort = (input: Readonly<{
  convexUrl: string | undefined;
  mysql: Pool | undefined;
  env?: NodeJS.ProcessEnv;
  log?: Pick<Console, 'warn'>;
}>): PublicProfilePort => {
  const convexUrl = input.convexUrl?.trim();
  if (!convexUrl) throw new Error('CONVEX_URL is required for public profile reads');
  const convex = createConvexPublicProfileAdapter(new ConvexHttpClient(convexUrl));
  const mode = profileReadModeFromEnvironment(input.env);
  if (!input.mysql || mode === 'convex') return convex;

  const mysql = createMysqlPublicProfileAdapter(input.mysql);
  return createProfilePortForMode({
    mode,
    convex,
    mysql,
    sink: createMysqlProfileDifferenceSink(input.mysql),
    log: input.log,
  });
};