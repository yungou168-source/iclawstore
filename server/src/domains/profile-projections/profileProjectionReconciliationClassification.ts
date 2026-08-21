import type { ReconciliationDifference } from '../migration/migrationPort.js';

export const PROFILE_PROJECTION_RECONCILIATION_DOMAIN = 'profile_projections';

export type ProfileProjectionDifferenceClassification = Exclude<
  NonNullable<ReconciliationDifference['classification']>,
  'unclassified'
>;

const allowed = new Set<ProfileProjectionDifferenceClassification>([
  'expected_transform',
  'expected_retired_fixture',
  'source_bug',
  'migration_bug',
  'concurrent_change',
]);

export const classifyProfileProjectionDifference = (input: Readonly<{
  classification: ProfileProjectionDifferenceClassification;
  approvalRef: string;
}>): Readonly<{ classification: ProfileProjectionDifferenceClassification; approvalRef: string }> => {
  const approvalRef = input.approvalRef.trim();
  if (!allowed.has(input.classification) || !approvalRef) {
    throw new Error('Profile projection difference classification requires an allowed classification and approval reference');
  }
  return Object.freeze({ classification: input.classification, approvalRef });
};

export const unclassifiedProfileProjectionDifference = <T extends Omit<ReconciliationDifference, 'domain' | 'classification'>>(
  difference: T,
): ReconciliationDifference => ({
  ...difference,
  domain: PROFILE_PROJECTION_RECONCILIATION_DOMAIN,
  classification: 'unclassified',
});