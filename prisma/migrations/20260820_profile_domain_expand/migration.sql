-- Expand-only profile migration. Convex remains the authoritative public profile source
-- until the server-side domain flag is explicitly promoted.

CREATE TABLE `profile_snapshots` (
  `id` VARCHAR(36) NOT NULL,
  `legacyConvexId` VARCHAR(191) NOT NULL,
  `handle` VARCHAR(191) NULL,
  `profileSlug` VARCHAR(40) NULL,
  `name` VARCHAR(191) NULL,
  `displayName` VARCHAR(191) NULL,
  `bio` TEXT NULL,
  `image` VARCHAR(2048) NULL,
  `imageStorageId` VARCHAR(191) NULL,
  `developerStatus` VARCHAR(32) NULL,
  `developerAppliedAt` DATETIME(3) NULL,
  `developerApprovedAt` DATETIME(3) NULL,
  `role` VARCHAR(32) NULL,
  `trustedPublisher` BOOLEAN NOT NULL DEFAULT FALSE,
  `publishedSkills` INTEGER NOT NULL DEFAULT 0,
  `totalStars` INTEGER NOT NULL DEFAULT 0,
  `totalDownloads` INTEGER NOT NULL DEFAULT 0,
  `personalPublisherLegacyConvexId` VARCHAR(191) NULL,
  `deletedAt` DATETIME(3) NULL,
  `deactivatedAt` DATETIME(3) NULL,
  `purgedAt` DATETIME(3) NULL,
  `banReason` VARCHAR(500) NULL,
  `legacyCreationTime` BIGINT NOT NULL,
  `legacyCreatedAt` DATETIME(3) NULL,
  `legacyUpdatedAt` DATETIME(3) NULL,
  `sourceHash` CHAR(64) NOT NULL,
  `syncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `profile_snapshots_legacy_convex_id_key` (`legacyConvexId`),
  UNIQUE KEY `profile_snapshots_profile_slug_key` (`profileSlug`),
  KEY `profile_snapshots_active_slug_idx` (`deletedAt`, `deactivatedAt`, `profileSlug`),
  KEY `profile_snapshots_active_handle_idx` (`deletedAt`, `deactivatedAt`, `handle`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `profile_legacy_id_maps` (
  `legacyConvexId` VARCHAR(191) NOT NULL,
  `mysqlProfileId` VARCHAR(36) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`legacyConvexId`),
  UNIQUE KEY `profile_legacy_id_maps_mysql_profile_id_key` (`mysqlProfileId`),
  CONSTRAINT `profile_legacy_id_maps_profile_fk`
    FOREIGN KEY (`mysqlProfileId`) REFERENCES `profile_snapshots` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `profile_migration_batches` (
  `id` VARCHAR(36) NOT NULL,
  `source` VARCHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `requestedBy` VARCHAR(191) NULL,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completedAt` DATETIME(3) NULL,
  `failedAt` DATETIME(3) NULL,
  `failureCode` VARCHAR(128) NULL,
  `sourceCount` INTEGER NULL,
  `upsertedCount` INTEGER NOT NULL DEFAULT 0,
  `unchangedCount` INTEGER NOT NULL DEFAULT 0,
  `errorCount` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `profile_migration_batches_status_started_idx` (`status`, `startedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `profile_migration_cursors` (
  `batchId` VARCHAR(36) NOT NULL,
  `cursorName` VARCHAR(64) NOT NULL,
  `cursorValue` TEXT NULL,
  `isComplete` BOOLEAN NOT NULL DEFAULT FALSE,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`batchId`, `cursorName`),
  CONSTRAINT `profile_migration_cursors_batch_fk`
    FOREIGN KEY (`batchId`) REFERENCES `profile_migration_batches` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `profile_reconciliation_records` (
  `id` VARCHAR(36) NOT NULL,
  `recordKey` CHAR(64) NOT NULL,
  `batchId` VARCHAR(36) NULL,
  `legacyConvexId` VARCHAR(191) NOT NULL,
  `fieldName` VARCHAR(64) NOT NULL,
  `differenceKind` VARCHAR(64) NOT NULL,
  `summary` VARCHAR(512) NOT NULL,
  `observedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `profile_reconciliation_record_key` (`recordKey`),
  KEY `profile_reconciliation_legacy_observed_idx` (`legacyConvexId`, `observedAt`),
  CONSTRAINT `profile_reconciliation_batch_fk`
    FOREIGN KEY (`batchId`) REFERENCES `profile_migration_batches` (`id`) ON DELETE SET NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;