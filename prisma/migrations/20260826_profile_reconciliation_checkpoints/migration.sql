-- Expand-only Profile reconciliation resume and audit evidence. This migration is not executed by source changes.
CREATE TABLE `profile_reconciliation_checkpoints` (
  `batchId` VARCHAR(36) NOT NULL,
  `sourceWatermark` BIGINT NOT NULL,
  `sourceCursor` TEXT NULL,
  `sourceRange` VARCHAR(64) NOT NULL,
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
  KEY `profile_reconciliation_checkpoints_status_idx` (`completedAt`, `failedAt`, `updatedAt`),
  CONSTRAINT `profile_reconciliation_checkpoints_batch_fk`
    FOREIGN KEY (`batchId`) REFERENCES `convex_exit_migration_batches` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `convex_exit_reconciliation_records`
  ADD COLUMN `classificationReason` VARCHAR(512) NULL AFTER `classification`,
  ADD COLUMN `classifiedBy` VARCHAR(191) NULL AFTER `classificationReason`,
  ADD COLUMN `classifiedAt` DATETIME(3) NULL AFTER `classifiedBy`,
  ADD COLUMN `waivedBy` VARCHAR(191) NULL AFTER `classifiedAt`,
  ADD COLUMN `waivedAt` DATETIME(3) NULL AFTER `waivedBy`,
  ADD COLUMN `waiverReason` VARCHAR(512) NULL AFTER `waivedAt`,
  ADD COLUMN `closedBy` VARCHAR(191) NULL AFTER `waiverReason`,
  ADD COLUMN `closedAt` DATETIME(3) NULL AFTER `closedBy`,
  ADD COLUMN `closureReason` VARCHAR(512) NULL AFTER `closedAt`;

CREATE TABLE `profile_reconciliation_source_ids` (
  `batchId` VARCHAR(36) NOT NULL,
  `legacyConvexId` VARCHAR(191) NOT NULL,
  `observedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`batchId`, `legacyConvexId`),
  CONSTRAINT `profile_reconciliation_source_ids_batch_fk`
    FOREIGN KEY (`batchId`) REFERENCES `profile_reconciliation_checkpoints` (`batchId`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;