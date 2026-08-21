-- Expand-only Publisher/organization candidate projection for the Convex exit program.
-- This migration does not change the current publisher write authority or activate a data path.

CREATE TABLE `publisher_snapshots` (
  `id` VARCHAR(36) NOT NULL,
  `legacyConvexId` VARCHAR(191) NOT NULL,
  `kind` VARCHAR(16) NOT NULL,
  `handle` VARCHAR(40) NOT NULL,
  `displayName` VARCHAR(191) NOT NULL,
  `bio` TEXT NULL,
  `sourceImageUrl` TEXT NULL,
  `sourceImageStorageId` VARCHAR(191) NULL,
  `linkedProfileId` VARCHAR(36) NULL,
  `linkedUserLegacyConvexId` VARCHAR(191) NULL,
  `trustedPublisher` BOOLEAN NOT NULL DEFAULT FALSE,
  `publishedSkills` INTEGER NOT NULL DEFAULT 0,
  `publishedPackages` INTEGER NOT NULL DEFAULT 0,
  `totalInstalls` INTEGER NOT NULL DEFAULT 0,
  `totalDownloads` INTEGER NOT NULL DEFAULT 0,
  `totalStars` INTEGER NOT NULL DEFAULT 0,
  `skillTotalInstalls` INTEGER NOT NULL DEFAULT 0,
  `skillTotalDownloads` INTEGER NOT NULL DEFAULT 0,
  `skillTotalStars` INTEGER NOT NULL DEFAULT 0,
  `deletedAt` DATETIME(3) NULL,
  `deactivatedAt` DATETIME(3) NULL,
  `legacyCreationTime` BIGINT NOT NULL,
  `legacyCreatedAt` DATETIME(3) NOT NULL,
  `legacyUpdatedAt` DATETIME(3) NOT NULL,
  `sourceHash` CHAR(64) NOT NULL,
  `lastSeenBatchId` VARCHAR(36) NOT NULL,
  `sourceMissingAt` DATETIME(3) NULL,
  `syncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `publisher_snapshots_legacy_convex_id_key` (`legacyConvexId`),
  UNIQUE KEY `publisher_snapshots_handle_key` (`handle`),
  UNIQUE KEY `publisher_snapshots_linked_user_key` (`linkedUserLegacyConvexId`),
  KEY `publisher_snapshots_active_kind_downloads_idx` (`deletedAt`, `deactivatedAt`, `kind`, `totalDownloads`, `legacyUpdatedAt`),
  KEY `publisher_snapshots_active_handle_idx` (`deletedAt`, `deactivatedAt`, `handle`),
  KEY `publisher_snapshots_seen_batch_idx` (`lastSeenBatchId`, `sourceMissingAt`),
  KEY `publisher_snapshots_linked_profile_idx` (`linkedProfileId`),
  CONSTRAINT `publisher_snapshots_linked_profile_fk`
    FOREIGN KEY (`linkedProfileId`) REFERENCES `profile_snapshots` (`id`) ON DELETE SET NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `publisher_member_snapshots` (
  `id` VARCHAR(36) NOT NULL,
  `legacyConvexId` VARCHAR(191) NOT NULL,
  `publisherId` VARCHAR(36) NOT NULL,
  `memberProfileId` VARCHAR(36) NOT NULL,
  `memberUserLegacyConvexId` VARCHAR(191) NOT NULL,
  `role` VARCHAR(16) NOT NULL,
  `legacyCreationTime` BIGINT NOT NULL,
  `legacyCreatedAt` DATETIME(3) NOT NULL,
  `legacyUpdatedAt` DATETIME(3) NOT NULL,
  `sourceHash` CHAR(64) NOT NULL,
  `lastSeenBatchId` VARCHAR(36) NOT NULL,
  `syncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `publisher_member_snapshots_legacy_convex_id_key` (`legacyConvexId`),
  UNIQUE KEY `publisher_member_snapshots_publisher_user_key` (`publisherId`, `memberUserLegacyConvexId`),
  KEY `publisher_member_snapshots_user_role_idx` (`memberUserLegacyConvexId`, `role`, `publisherId`),
  KEY `publisher_member_snapshots_publisher_role_idx` (`publisherId`, `role`, `memberUserLegacyConvexId`),
  KEY `publisher_member_snapshots_profile_idx` (`memberProfileId`),
  KEY `publisher_member_snapshots_seen_batch_idx` (`lastSeenBatchId`, `publisherId`),
  CONSTRAINT `publisher_member_snapshots_publisher_fk`
    FOREIGN KEY (`publisherId`) REFERENCES `publisher_snapshots` (`id`) ON DELETE CASCADE,
  CONSTRAINT `publisher_member_snapshots_profile_fk`
    FOREIGN KEY (`memberProfileId`) REFERENCES `profile_snapshots` (`id`) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `official_publisher_snapshots` (
  `id` VARCHAR(36) NOT NULL,
  `legacyConvexId` VARCHAR(191) NOT NULL,
  `publisherId` VARCHAR(36) NOT NULL,
  `reason` VARCHAR(500) NULL,
  `createdByProfileId` VARCHAR(36) NULL,
  `createdByUserLegacyConvexId` VARCHAR(191) NULL,
  `legacyCreationTime` BIGINT NOT NULL,
  `legacyCreatedAt` DATETIME(3) NOT NULL,
  `legacyUpdatedAt` DATETIME(3) NOT NULL,
  `sourceHash` CHAR(64) NOT NULL,
  `lastSeenBatchId` VARCHAR(36) NOT NULL,
  `syncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `official_publisher_snapshots_legacy_convex_id_key` (`legacyConvexId`),
  UNIQUE KEY `official_publisher_snapshots_publisher_key` (`publisherId`),
  KEY `official_publisher_snapshots_created_idx` (`legacyCreatedAt`, `publisherId`),
  KEY `official_publisher_snapshots_created_by_profile_idx` (`createdByProfileId`),
  KEY `official_publisher_snapshots_seen_batch_idx` (`lastSeenBatchId`, `publisherId`),
  CONSTRAINT `official_publisher_snapshots_publisher_fk`
    FOREIGN KEY (`publisherId`) REFERENCES `publisher_snapshots` (`id`) ON DELETE CASCADE,
  CONSTRAINT `official_publisher_snapshots_created_by_profile_fk`
    FOREIGN KEY (`createdByProfileId`) REFERENCES `profile_snapshots` (`id`) ON DELETE SET NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `publisher_sync_checkpoints` (
  `id` VARCHAR(36) NOT NULL,
  `batchId` VARCHAR(36) NOT NULL,
  `watermark` BIGINT NOT NULL,
  `windowStart` BIGINT NOT NULL,
  `cursorAgeMs` BIGINT NULL,
  `retryCount` INTEGER NOT NULL DEFAULT 0,
  `lastFailureCode` VARCHAR(128) NULL,
  `completedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `publisher_sync_checkpoints_batch_key` (`batchId`),
  KEY `publisher_sync_checkpoints_watermark_idx` (`watermark`),
  CONSTRAINT `publisher_sync_checkpoints_batch_fk`
    FOREIGN KEY (`batchId`) REFERENCES `convex_exit_migration_batches` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `publisher_avatar_snapshots` (
  `id` VARCHAR(36) NOT NULL,
  `publisherId` VARCHAR(36) NOT NULL,
  `sourceStorageId` VARCHAR(191) NULL,
  `targetAssetId` VARCHAR(36) NULL,
  `sourceUrl` TEXT NULL,
  `contentType` VARCHAR(255) NULL,
  `byteLength` BIGINT NULL,
  `sha256` CHAR(64) NULL,
  `accessScope` VARCHAR(32) NOT NULL DEFAULT 'public',
  `status` VARCHAR(64) NOT NULL DEFAULT 'pending',
  `failureCode` VARCHAR(128) NULL,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `publisher_avatar_snapshots_publisher_key` (`publisherId`),
  KEY `publisher_avatar_snapshots_source_storage_idx` (`sourceStorageId`),
  KEY `publisher_avatar_snapshots_target_asset_idx` (`targetAssetId`),
  KEY `publisher_avatar_snapshots_status_idx` (`status`, `updatedAt`),
  CONSTRAINT `publisher_avatar_snapshots_publisher_fk`
    FOREIGN KEY (`publisherId`) REFERENCES `publisher_snapshots` (`id`) ON DELETE CASCADE,
  CONSTRAINT `publisher_avatar_snapshots_target_asset_fk`
    FOREIGN KEY (`targetAssetId`) REFERENCES `convex_exit_managed_assets` (`id`) ON DELETE SET NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;