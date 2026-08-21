import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createConnection } from "mysql2/promise";

const COMMAND_TIMEOUT_MS = 120_000;
const DEFAULT_TEST_FILES = [
  "test/aiDirectCoreMysql.test.ts",
  "test/approvalDecisionMysql.test.ts",
  "test/aiDirectWorkforceEmployeeDirectoryMysql.test.ts",
  "test/desktopPreferencesMysql.test.ts",
  "test/outboxDispatcherMysql.test.ts",
  "test/workerRuntimeMysql.test.ts",
];

function requestedTestFiles(): string[] {
  const files = process.argv.slice(2);
  if (files.some((file) => !/^test\/[A-Za-z0-9._-]+\.test\.ts$/.test(file))) {
    throw new Error("Integration test paths must match test/<name>.test.ts");
  }
  return files.length > 0 ? files : DEFAULT_TEST_FILES;
}

async function run(command: string[], environment: Record<string, string>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command[0]!, command.slice(1), {
      cwd: process.cwd(),
      env: { ...process.env, ...environment, NODE_OPTIONS: "--max-old-space-size=512" },
      stdio: "inherit",
    });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command.join(" ")} exceeded ${COMMAND_TIMEOUT_MS}ms`));
    }, COMMAND_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (exitCode, signal) => {
      clearTimeout(timeout);
      if (exitCode === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command.join(" ")} exited with ${exitCode ?? signal}`));
    });
  });
}

async function readDatabaseUrl(): Promise<string | undefined> {
  if (process.env.TEST_MYSQL_ADMIN_URL) return process.env.TEST_MYSQL_ADMIN_URL;
  if (process.env.TEST_MYSQL_ENV_FILE) {
    const content = await readFile(process.env.TEST_MYSQL_ENV_FILE, "utf8");
    const match = content.match(
      /^(?:export\s+)?(?:TEST_MYSQL_ADMIN_URL|DATABASE_URL)\s*=\s*(.+)$/m,
    );
    if (!match) return undefined;
    const raw = match[1]!.trim();
    const quoted =
      (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"));
    return quoted ? raw.slice(1, -1) : raw;
  }
  return process.env.DATABASE_URL;
}

async function main(): Promise<void> {
  const sourceUrl = await readDatabaseUrl();
  if (!sourceUrl?.startsWith("mysql")) {
    throw new Error("A MySQL TEST_MYSQL_ADMIN_URL or DATABASE_URL is required");
  }

  const databaseName = `clawhub_it_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const adminUrl = new URL(sourceUrl);
  const testUrl = new URL(sourceUrl);
  testUrl.pathname = `/${databaseName}`;
  console.log(
    `Connecting to MySQL at ${adminUrl.hostname}:${adminUrl.port || "3306"} with a 5s timeout`,
  );
  const connection = await createConnection({ uri: adminUrl.toString(), connectTimeout: 5_000 });

  try {
    await connection.query(
      `CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    console.log(`Created isolated MySQL integration database: ${databaseName}`);

    await run(
      ["../node_modules/.bin/prisma", "migrate", "deploy", "--schema", "../prisma/schema.prisma"],
      { DATABASE_URL: testUrl.toString() },
    );
    for (const testFile of requestedTestFiles()) {
      await run(["bun", "test", testFile], { TEST_DATABASE_URL: testUrl.toString() });
    }
  } finally {
    await connection.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    await connection.end();
    console.log(`Dropped isolated MySQL integration database: ${databaseName}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
