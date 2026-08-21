import { createHash, randomUUID } from "node:crypto";

export type MigrationSqlConnection = Readonly<{
  query: (sql: string, values?: readonly unknown[]) => Promise<unknown>;
}>;

export type MigrationBatchStatus = "running" | "completed" | "failed";

export type MigrationBatch = Readonly<{
  id: string;
  domain: string;
  source: string;
  approvalRef?: string;
  requestedBy?: string;
}>;

export type MigrationProgress = Readonly<{
  cursor: string | null;
  sourceCount?: bigint;
  upsertedCount: bigint;
  unchangedCount: bigint;
  errorCount: bigint;
  completed: boolean;
}>;

export type ReconciliationDifference = Readonly<{
  domain: string;
  batchId?: string;
  legacyConvexId: string;
  fieldName: string;
  differenceKind: string;
  classification?: "expected_transform" | "expected_retired_fixture" | "source_bug" | "migration_bug" | "concurrent_change" | "unclassified";
  sourceEvidence?: Readonly<Record<string, unknown>>;
  targetEvidence?: Readonly<Record<string, unknown>>;
  evidenceHash?: string;
  summary: string;
}>;

export type DomainEvent = Readonly<{
  domain: string;
  aggregateId: string;
  aggregateVersion: bigint;
  eventType: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}>;

type CursorRow = Readonly<{ sourceCursor: string | null; status: MigrationBatchStatus }>;
type LegacyMapRow = Readonly<{ targetId: string }>;

const required = (value: string, name: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
};

const differenceKey = (input: ReconciliationDifference): string =>
  createHash("sha256")
    .update(
      JSON.stringify([
        input.domain,
        input.legacyConvexId,
        input.fieldName,
        input.differenceKind,
        input.summary,
      ]),
    )
    .digest("hex");

const evidenceJson = (value: Readonly<Record<string, unknown>> | undefined): string | null =>
  value ? JSON.stringify(value) : null;

const evidenceHash = (input: ReconciliationDifference): string | null => {
  if (!input.sourceEvidence && !input.targetEvidence) return input.evidenceHash ?? null;
  return createHash("sha256")
    .update(JSON.stringify({ source: input.sourceEvidence ?? null, target: input.targetEvidence ?? null }))
    .digest("hex");
};

const resultRows = <T>(result: unknown): T[] => {
  if (!Array.isArray(result) || !Array.isArray(result[0])) return [];
  return result[0] as T[];
};

export const createMigrationPort = (connection: MigrationSqlConnection) =>
  Object.freeze({
    startBatch: async (input: MigrationBatch): Promise<void> => {
      const batch = {
        id: required(input.id, "batch id"),
        domain: required(input.domain, "domain"),
        source: required(input.source, "source"),
      };
      await connection.query(
        `INSERT INTO convex_exit_migration_batches
          (id, domain, source, status, approvalRef, requestedBy)
         VALUES (?, ?, ?, 'running', ?, ?)
         ON DUPLICATE KEY UPDATE
           status = IF(status = 'completed', status, 'running'),
           approvalRef = COALESCE(VALUES(approvalRef), approvalRef),
           requestedBy = COALESCE(VALUES(requestedBy), requestedBy),
           failedAt = NULL,
           failureCode = NULL`,
        [
          batch.id,
          batch.domain,
          batch.source,
          input.approvalRef ?? null,
          input.requestedBy ?? null,
        ],
      );
    },

    loadBatchState: async (
      batchId: string,
    ): Promise<Readonly<{ cursor: string | null; status: MigrationBatchStatus }> | null> => {
      const [row] = resultRows<CursorRow>(
        await connection.query(
          "SELECT sourceCursor, status FROM convex_exit_migration_batches WHERE id = ? LIMIT 1",
          [required(batchId, "batch id")],
        ),
      );
      return row ? { cursor: row.sourceCursor, status: row.status } : null;
    },

    loadCursor: async (batchId: string): Promise<string | null> => {
      const [row] = resultRows<CursorRow>(
        await connection.query(
          "SELECT sourceCursor, status FROM convex_exit_migration_batches WHERE id = ? LIMIT 1",
          [required(batchId, "batch id")],
        ),
      );
      return row?.sourceCursor ?? null;
    },

    persistProgress: async (batchId: string, progress: MigrationProgress): Promise<void> => {
      await connection.query(
        `UPDATE convex_exit_migration_batches
         SET sourceCursor = ?,
             sourceCount = COALESCE(?, sourceCount),
             upsertedCount = upsertedCount + ?,
             unchangedCount = unchangedCount + ?,
             errorCount = errorCount + ?,
             status = IF(?, 'completed', 'running'),
             completedAt = IF(?, CURRENT_TIMESTAMP(3), NULL)
         WHERE id = ? AND status <> 'completed'`,
        [
          progress.cursor,
          progress.sourceCount ?? null,
          progress.upsertedCount,
          progress.unchangedCount,
          progress.errorCount,
          progress.completed,
          progress.completed,
          required(batchId, "batch id"),
        ],
      );
    },

    ensureLegacyIdMap: async (
      input: Readonly<{ domain: string; legacyConvexId: string; targetId: string }>,
    ): Promise<void> => {
      const domain = required(input.domain, "domain");
      const legacyConvexId = required(input.legacyConvexId, "legacy Convex ID");
      const targetId = required(input.targetId, "target ID");
      const [existing] = resultRows<LegacyMapRow>(
        await connection.query(
          `SELECT targetId FROM convex_exit_legacy_id_maps
           WHERE domain = ? AND legacyConvexId = ? LIMIT 1`,
          [domain, legacyConvexId],
        ),
      );
      if (existing && existing.targetId !== targetId) {
        throw new Error("Legacy Convex ID maps to a different target ID");
      }
      await connection.query(
        `INSERT INTO convex_exit_legacy_id_maps (domain, legacyConvexId, targetId)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE targetId = VALUES(targetId)`,
        [domain, legacyConvexId, targetId],
      );
    },

    recordDifference: async (difference: ReconciliationDifference): Promise<void> => {
      const recordKey = differenceKey(difference);
      await connection.query(
        `INSERT INTO convex_exit_reconciliation_records
          (id, recordKey, domain, batchId, legacyConvexId, fieldName, differenceKind, classification,
           sourceEvidence, targetEvidence, evidenceHash, summary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE observedAt = CURRENT_TIMESTAMP(3),
           batchId = VALUES(batchId), classification = VALUES(classification),
           sourceEvidence = VALUES(sourceEvidence), targetEvidence = VALUES(targetEvidence),
           evidenceHash = VALUES(evidenceHash), summary = VALUES(summary), resolvedAt = NULL`,
        [
          randomUUID(),
          recordKey,
          required(difference.domain, "domain"),
          difference.batchId ?? null,
          required(difference.legacyConvexId, "legacy Convex ID"),
          required(difference.fieldName, "field name"),
          required(difference.differenceKind, "difference kind"),
          difference.classification ?? "unclassified",
          evidenceJson(difference.sourceEvidence),
          evidenceJson(difference.targetEvidence),
          evidenceHash(difference),
          required(difference.summary, "difference summary"),
        ],
      );
    },

    publishDomainEvent: async (event: DomainEvent): Promise<void> => {
      await connection.query(
        `INSERT INTO convex_exit_outbox_events
          (id, domain, aggregateId, aggregateVersion, eventType, idempotencyKey, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE id = id`,
        [
          randomUUID(),
          required(event.domain, "domain"),
          required(event.aggregateId, "aggregate ID"),
          event.aggregateVersion,
          required(event.eventType, "event type"),
          required(event.idempotencyKey, "idempotency key"),
          JSON.stringify(event.payload),
        ],
      );
    },

    recordFailure: async (batchId: string, failureCode: string): Promise<void> => {
      await connection.query(
        `UPDATE convex_exit_migration_batches
         SET status = 'failed', failedAt = CURRENT_TIMESTAMP(3), failureCode = ?, errorCount = errorCount + 1
         WHERE id = ? AND status <> 'completed'`,
        [required(failureCode, "failure code"), required(batchId, "batch id")],
      );
    },
  });

export type MigrationPort = ReturnType<typeof createMigrationPort>;
