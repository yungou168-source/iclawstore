import { createConnection, type RowDataPacket } from "mysql2/promise";

const CONTROLLING_STATUSES = ["accepted", "onboarding", "active", "paused", "offboarding"] as const;

type ConflictRow = RowDataPacket & {
  agentId: string;
  employmentCount: string | number;
  employmentIds: string;
  companyIds: string;
};

type OrphanRow = RowDataPacket & {
  employmentId: string;
  agentId: string;
  companyId: string;
  status: string;
};

function describeDatabase(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);
  const database = parsed.pathname.replace(/^\//, "") || "(default)";
  return `${parsed.hostname}:${parsed.port || "3306"}/${database}`;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const connection = await createConnection(databaseUrl);
  try {
    const placeholders = CONTROLLING_STATUSES.map(() => "?").join(", ");
    const [conflicts] = await connection.query<ConflictRow[]>(
      `SELECT
         employment.agentId,
         COUNT(*) AS employmentCount,
         GROUP_CONCAT(employment.id ORDER BY employment.createdAt, employment.id) AS employmentIds,
         GROUP_CONCAT(DISTINCT employment.companyId ORDER BY employment.companyId) AS companyIds
       FROM ai_direct_employments AS employment
       WHERE employment.status IN (${placeholders})
       GROUP BY employment.agentId
       HAVING COUNT(*) > 1
       ORDER BY employment.agentId`,
      [...CONTROLLING_STATUSES],
    );

    const [orphans] = await connection.query<OrphanRow[]>(
      `SELECT
         employment.id AS employmentId,
         employment.agentId,
         employment.companyId,
         employment.status
       FROM ai_direct_employments AS employment
       LEFT JOIN ai_direct_agents AS agent ON agent.id = employment.agentId
       WHERE employment.status IN (${placeholders})
         AND agent.id IS NULL
       ORDER BY employment.agentId, employment.id`,
      [...CONTROLLING_STATUSES],
    );

    const result = {
      database: describeDatabase(databaseUrl),
      controllingStatuses: CONTROLLING_STATUSES,
      conflictCount: conflicts.length,
      orphanCount: orphans.length,
      conflicts,
      orphans,
    };

    console.log(JSON.stringify(result, null, 2));
    if (conflicts.length > 0 || orphans.length > 0) {
      process.exitCode = 2;
    }
  } finally {
    await connection.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Agent appearance migration preflight failed: ${message}`);
  process.exitCode = 1;
});
