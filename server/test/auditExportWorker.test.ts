import { describe, expect, it, vi } from "bun:test";
import { runNextAuditExport } from "../src/services/auditExportWorker.js";

function createPool() {
  const job = {
    id: "export-1",
    organizationId: "org-1",
    requestedByUserId: "user-1",
    filters: JSON.stringify({
      organizationId: "org-1",
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-02T00:00:00.000Z",
    }),
    watermark: "org-1:user-1:export-1",
    attemptCount: 0,
  };
  const connection = {
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
    release: vi.fn(),
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM ai_direct_audit_export_jobs")) return [[job], []];
      return [{ affectedRows: 1 }, []];
    }),
  };
  let artifact: Buffer | null = null;
  const pool = {
    getConnection: vi.fn(async () => connection),
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("audit_projection")) {
        return [
          [
            {
              source: "domain",
              id: "event-1",
              organizationId: "org-1",
              actorUserId: "user-2",
              action: "=unsafe-formula",
              resourceType: "employment",
              resourceId: "employment-1",
              requestId: "request-1",
              outcome: "success",
              metadata: { prompt: "hidden", companyId: "company-1" },
              createdAt: "2026-08-01T12:00:00.000Z",
            },
          ],
          [],
        ];
      }
      if (sql.includes("SET status = 'completed'")) artifact = values?.[0] as Buffer;
      return [{ affectedRows: 1 }, []];
    }),
  };
  return { pool, connection, artifact: () => artifact };
}

describe("audit export worker", () => {
  it("leases one job and stores a watermarked, redacted, formula-safe CSV", async () => {
    const fake = createPool();
    const result = await runNextAuditExport(fake.pool as any, "worker-1");
    const csv = fake.artifact()?.toString("utf8") ?? "";

    expect(result).toMatchObject({ kind: "completed", jobId: "export-1", rowCount: 1 });
    expect(fake.connection.commit).toHaveBeenCalledTimes(1);
    expect(csv).toContain("org-1:user-1:export-1");
    expect(csv).toContain("'=unsafe-formula");
    expect(csv).toContain("company-1");
    expect(csv).not.toContain("hidden");
  });
});
