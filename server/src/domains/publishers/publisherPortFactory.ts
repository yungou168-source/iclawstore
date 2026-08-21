import type { Pool } from "mysql2/promise";
import { createMysqlPublicPublisherAdapter } from "./mysqlPublicPublisherAdapter.js";
import type { PublicPublisherPort } from "./publicPublisherPort.js";
import type { PublisherReadObserver } from "./publisherReadObservability.js";

export type PublisherReadMode = "mysql_authoritative";

export const publisherReadModeFromEnvironment = (
  _env: NodeJS.ProcessEnv = process.env,
): PublisherReadMode => "mysql_authoritative";

export const createPublicPublisherPort = (
  input: Readonly<{
    mysql: Pool | undefined;
    observer?: PublisherReadObserver;
  }>,
): PublicPublisherPort => {
  if (!input.mysql) throw new Error("MySQL is required for public Publisher reads");
  return createMysqlPublicPublisherAdapter(input.mysql);
};