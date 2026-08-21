import type { Pool } from "mysql2/promise";
import { createMysqlPublicProfileAdapter } from "./mysqlPublicProfileAdapter.js";
import type { ProfileReadObserver } from "./profileReadObservability.js";
import type { PublicProfilePort } from "./publicProfilePort.js";

export type ProfileReadMode = "mysql_authoritative";

export const profileReadModeFromEnvironment = (
  _env: NodeJS.ProcessEnv = process.env,
): ProfileReadMode => "mysql_authoritative";

export const createPublicProfilePort = (
  input: Readonly<{
    mysql: Pool | undefined;
    observer?: ProfileReadObserver;
  }>,
): PublicProfilePort => {
  if (!input.mysql) throw new Error("MySQL is required for public profile reads");
  return createMysqlPublicProfileAdapter(input.mysql);
};