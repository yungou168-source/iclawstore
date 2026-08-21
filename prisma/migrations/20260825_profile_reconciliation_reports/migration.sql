-- Immutable per-run Profile reconciliation evidence. This migration is expand-only and is not executed by source changes.
CREATE TABLE `profile_reconciliation_reports` (
  `id` VARCHAR(36) NOT NULL,
  `batchId` VARCHAR(36) NOT NULL,
  `sourceProfiles` BIGINT NOT NULL,
  `targetProfiles` BIGINT NOT NULL,
  `comparedProfiles` BIGINT NOT NULL,
  `differenceCount` BIGINT NOT NULL,
  `unclassifiedDifferenceCount` BIGINT NOT NULL,
  `candidateReady` BOOLEAN NOT NULL DEFAULT FALSE,
  `sourceCursor` TEXT NULL,
  `failureCode` VARCHAR(128) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `profile_reconciliation_reports_batch_key` (`batchId`),
  KEY `profile_reconciliation_reports_gate_idx` (`candidateReady`, `createdAt`),
  CONSTRAINT `profile_reconciliation_reports_batch_fk`
    FOREIGN KEY (`batchId`) REFERENCES `convex_exit_migration_batches` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;