-- Expand-only Skill/Package reconciliation evidence. This migration is not executed by source changes.
-- It creates no runtime process, database connection, artifact copy, or read/write cutover.

CREATE TABLE `skill_package_reconciliation_checkpoints` (
  `batchId` VARCHAR(36) NOT NULL,
  `domain` VARCHAR(16) NOT NULL,
  `sourceCursor` TEXT NULL,
  `pageCount` BIGINT NOT NULL DEFAULT 0,
  `sourceCount` BIGINT NOT NULL DEFAULT 0,
  `comparedCount` BIGINT NOT NULL DEFAULT 0,
  `differenceCount` BIGINT NOT NULL DEFAULT 0,
  `sourceExhaustedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `failedAt` DATETIME(3) NULL,
  `failureCode` VARCHAR(128) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`batchId`),
  KEY `skill_package_reconciliation_checkpoints_status_idx` (`domain`, `completedAt`, `failedAt`, `updatedAt`),
  CONSTRAINT `skill_package_reconciliation_checkpoints_batch_fk`
    FOREIGN KEY (`batchId`) REFERENCES `convex_exit_migration_batches` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `skill_package_reconciliation_reports` (
  `id` VARCHAR(36) NOT NULL,
  `batchId` VARCHAR(36) NOT NULL,
  `domain` VARCHAR(16) NOT NULL,
  `sourceAggregates` BIGINT NOT NULL,
  `targetAggregates` BIGINT NOT NULL,
  `comparedAggregates` BIGINT NOT NULL,
  `differenceCount` BIGINT NOT NULL,
  `unclassifiedDifferenceCount` BIGINT NOT NULL,
  `orphanDifferenceCount` BIGINT NOT NULL,
  `missingAssetCount` BIGINT NOT NULL,
  `candidateReady` BOOLEAN NOT NULL DEFAULT FALSE,
  `sourceCursor` TEXT NULL,
  `checkpointComplete` BOOLEAN NOT NULL DEFAULT FALSE,
  `failureCode` VARCHAR(128) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `skill_package_reconciliation_reports_batch_key` (`batchId`),
  KEY `skill_package_reconciliation_reports_gate_idx` (`domain`, `candidateReady`, `createdAt`),
  CONSTRAINT `skill_package_reconciliation_reports_batch_fk`
    FOREIGN KEY (`batchId`) REFERENCES `convex_exit_migration_batches` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;