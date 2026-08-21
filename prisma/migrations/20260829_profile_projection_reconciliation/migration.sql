-- Resume and report evidence for profile downstream projection reconciliation.
CREATE TABLE `profile_projection_reconciliation_checkpoints` (
  `batchId` VARCHAR(36) NOT NULL,
  `phase` VARCHAR(16) NOT NULL,
  `sourceCursor` TEXT NULL,
  `pageCount` BIGINT NOT NULL DEFAULT 0,
  `sourceCount` BIGINT NOT NULL DEFAULT 0,
  `differenceCount` BIGINT NOT NULL DEFAULT 0,
  `completedAt` DATETIME(3) NULL,
  `failedAt` DATETIME(3) NULL,
  `failureCode` VARCHAR(128) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`batchId`, `phase`),
  KEY `profile_projection_reconciliation_checkpoint_status_idx` (`completedAt`, `failedAt`, `updatedAt`),
  CONSTRAINT `profile_projection_reconciliation_checkpoint_batch_fk`
    FOREIGN KEY (`batchId`) REFERENCES `convex_exit_migration_batches` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `profile_projection_reconciliation_reports` (
  `id` VARCHAR(36) NOT NULL,
  `batchId` VARCHAR(36) NOT NULL,
  `sourceCount` BIGINT NOT NULL,
  `differenceCount` BIGINT NOT NULL,
  `unclassifiedDifferenceCount` BIGINT NOT NULL,
  `candidateReady` BOOLEAN NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `profile_projection_reconciliation_report_batch_key` (`batchId`),
  CONSTRAINT `profile_projection_reconciliation_report_batch_fk`
    FOREIGN KEY (`batchId`) REFERENCES `convex_exit_migration_batches` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;