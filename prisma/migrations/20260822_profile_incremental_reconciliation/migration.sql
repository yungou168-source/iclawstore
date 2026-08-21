-- Expand-only persistence for Profile incremental synchronization and canonical aliases.
-- No runner or production read/write cutover is introduced by this migration.

CREATE TABLE `profile_sync_checkpoints` (
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
  UNIQUE KEY `profile_sync_checkpoints_batch_key` (`batchId`),
  KEY `profile_sync_checkpoints_watermark_idx` (`watermark`),
  CONSTRAINT `profile_sync_checkpoints_batch_fk`
    FOREIGN KEY (`batchId`) REFERENCES `convex_exit_migration_batches` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `profile_identity_aliases` (
  `id` VARCHAR(36) NOT NULL,
  `profileId` VARCHAR(36) NOT NULL,
  `aliasKind` VARCHAR(32) NOT NULL,
  `aliasValue` VARCHAR(191) NOT NULL,
  `isCanonical` BOOLEAN NOT NULL DEFAULT FALSE,
  `retiredAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `profile_identity_alias_kind_value_key` (`aliasKind`, `aliasValue`),
  KEY `profile_identity_alias_profile_idx` (`profileId`, `aliasKind`, `retiredAt`),
  CONSTRAINT `profile_identity_alias_profile_fk`
    FOREIGN KEY (`profileId`) REFERENCES `profile_snapshots` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `profile_asset_snapshots` (
  `id` VARCHAR(36) NOT NULL,
  `profileId` VARCHAR(36) NOT NULL,
  `sourceStorageId` VARCHAR(255) NULL,
  `targetAssetId` VARCHAR(36) NULL,
  `sourceUrl` TEXT NULL,
  `contentType` VARCHAR(255) NULL,
  `byteLength` BIGINT NULL,
  `sha256` CHAR(64) NULL,
  `acl` VARCHAR(64) NULL,
  `visibility` VARCHAR(64) NULL,
  `status` VARCHAR(64) NOT NULL DEFAULT 'pending',
  `failureCode` VARCHAR(128) NULL,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `profile_asset_snapshots_profile_key` (`profileId`),
  KEY `profile_asset_snapshots_source_storage_idx` (`sourceStorageId`),
  KEY `profile_asset_snapshots_target_asset_idx` (`targetAssetId`),
  KEY `profile_asset_snapshots_status_idx` (`status`),
  CONSTRAINT `profile_asset_snapshots_profile_fk`
    FOREIGN KEY (`profileId`) REFERENCES `profile_snapshots` (`id`) ON DELETE CASCADE,
  CONSTRAINT `profile_asset_snapshots_target_asset_fk`
    FOREIGN KEY (`targetAssetId`) REFERENCES `convex_exit_managed_assets` (`id`) ON DELETE SET NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;