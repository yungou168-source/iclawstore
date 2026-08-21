-- Expand-only reconciliation evidence for source/target alias state.
-- This migration does not classify, repair, close, or resolve any record.
ALTER TABLE `convex_exit_reconciliation_records`
  ADD COLUMN `sourceEvidence` TEXT NULL,
  ADD COLUMN `targetEvidence` TEXT NULL,
  ADD COLUMN `evidenceHash` CHAR(64) NULL;