import type { Pool } from "mysql2/promise";
import {
  inspectPublisherMigrationReadiness,
  requirePublisherMigrationAuthorization,
} from "./publisherMigrationPreflight.js";

export type PublisherProcessMode = "once" | "loop";

const required = (value: string | undefined, name: string): string => {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
};

export const requirePublisherMysqlDatabaseUrl = (
  environment: NodeJS.ProcessEnv = process.env,
): string => {
  const databaseUrl = required(environment.DATABASE_URL, "DATABASE_URL");
  if (!databaseUrl.startsWith("mysql")) throw new Error("DATABASE_URL must be a MySQL URL");
  return databaseUrl;
};

export const publisherBatchSize = (value: string | undefined): number => {
  const parsed = Number(value ?? 100);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 250) {
    throw new Error("PUBLISHER_MIGRATION_BATCH_SIZE must be an integer between 1 and 250");
  }
  return parsed;
};

export const publisherProcessMode = (value: string | undefined): PublisherProcessMode => {
  const mode = required(value, "PUBLISHER_PROCESS_MODE");
  if (mode !== "once" && mode !== "loop") {
    throw new Error("PUBLISHER_PROCESS_MODE must be once or loop");
  }
  return mode;
};

export const boundedPublisherInteger = (
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

export const authorizeAndPreflightPublisherProcess = async (
  pool: Pick<Pool, "query">,
  environment: NodeJS.ProcessEnv = process.env,
) => {
  const authorization = requirePublisherMigrationAuthorization(environment);
  const report = await inspectPublisherMigrationReadiness(pool);
  if (!report.ready) throw new Error("Publisher migration database structure is not ready");
  return { authorization, report };
};

export const installPublisherProcessShutdown = (): Readonly<{
  isStopping: () => boolean;
  dispose: () => void;
}> => {
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return Object.freeze({
    isStopping: () => stopping,
    dispose: () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    },
  });
};

export const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
