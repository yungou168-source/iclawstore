export type ReconciliationClassification =
  | 'expected_transform'
  | 'source_bug'
  | 'migration_bug'
  | 'concurrent_change';

type SqlConnection = Readonly<{
  query: (sql: string, values?: readonly unknown[]) => Promise<unknown>;
}>;

const required = (value: string, name: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
};

export const createProfileReconciliationLifecycle = (connection: SqlConnection) =>
  Object.freeze({
    classify: async (input: Readonly<{
      recordKey: string;
      classification: ReconciliationClassification;
      reason: string;
      actor: string;
      sourceEvidence: Readonly<Record<string, unknown>>;
      targetEvidence: Readonly<Record<string, unknown>>;
      evidenceHash: string;
    }>): Promise<void> => {
      const sourceEvidence = JSON.stringify(input.sourceEvidence);
      const targetEvidence = JSON.stringify(input.targetEvidence);
      const evidenceHash = required(input.evidenceHash, 'evidence hash');
      if (!sourceEvidence || !targetEvidence) throw new Error('source and target evidence are required');
      await connection.query(
        `UPDATE convex_exit_reconciliation_records
         SET classification = ?, classificationReason = ?, classifiedBy = ?,
             classifiedAt = CURRENT_TIMESTAMP(3)
         WHERE domain = 'profiles' AND recordKey = ? AND resolvedAt IS NULL
           AND sourceEvidence IS NOT NULL AND targetEvidence IS NOT NULL AND evidenceHash = ?`,
        [input.classification, required(input.reason, 'classification reason'), required(input.actor, 'actor'), required(input.recordKey, 'record key'), evidenceHash],
      );
    },
    waive: async (input: Readonly<{ recordKey: string; reason: string; actor: string }>): Promise<void> => {
      await connection.query(
        `UPDATE convex_exit_reconciliation_records
         SET waivedBy = ?, waivedAt = CURRENT_TIMESTAMP(3), waiverReason = ?
         WHERE domain = 'profiles' AND recordKey = ? AND resolvedAt IS NULL
           AND classification <> 'unclassified'`,
        [required(input.actor, 'actor'), required(input.reason, 'waiver reason'), required(input.recordKey, 'record key')],
      );
    },
    close: async (input: Readonly<{ recordKey: string; reason: string; actor: string }>): Promise<void> => {
      await connection.query(
        `UPDATE convex_exit_reconciliation_records
         SET closedBy = ?, closedAt = CURRENT_TIMESTAMP(3), closureReason = ?,
             resolvedAt = CURRENT_TIMESTAMP(3)
         WHERE domain = 'profiles' AND recordKey = ? AND resolvedAt IS NULL
           AND classification <> 'unclassified'`,
        [required(input.actor, 'actor'), required(input.reason, 'closure reason'), required(input.recordKey, 'record key')],
      );
    },
  });