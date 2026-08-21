-- Candidate-only, expand-only Soul migration foundation.
-- No routes, source reads, imports, asset copies, or cutover are activated here.

CREATE TABLE IF NOT EXISTS `soul_snapshots` (
  `id` VARCHAR(36) NOT NULL,
  `legacyConvexId` VARCHAR(191) NOT NULL,
  `slug` VARCHAR(255) NOT NULL,
  `displayName` VARCHAR(255) NOT NULL,
  `summary` TEXT NULL,
  `ownerUserLegacyConvexId` VARCHAR(191) NOT NULL,
  `ownerPublisherLegacyConvexId` VARCHAR(191) NULL,
  `latestVersionLegacyConvexId` VARCHAR(191) NULL,
  `tags` JSON NOT NULL,
  `stats` JSON NOT NULL,
  `legacyCreatedAt` DATETIME(3) NOT NULL,
  `legacyUpdatedAt` DATETIME(3) NOT NULL,
  `softDeletedAt` DATETIME(3) NULL,
  `sourceHash` CHAR(64) NOT NULL,
  `lastSeenBatchId` VARCHAR(36) NOT NULL,
  `sourceMissingAt` DATETIME(3) NULL,
  `syncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `soul_snapshots_legacy_key` (`legacyConvexId`),
  KEY `soul_snapshots_slug_idx` (`slug`),
  KEY `soul_snapshots_owner_idx` (`ownerUserLegacyConvexId`, `ownerPublisherLegacyConvexId`),
  KEY `soul_snapshots_active_updated_idx` (`softDeletedAt`, `legacyUpdatedAt`),
  KEY `soul_snapshots_seen_idx` (`lastSeenBatchId`, `sourceMissingAt`),
  CONSTRAINT `soul_snapshots_batch_fk`
    FOREIGN KEY (`lastSeenBatchId`) REFERENCES `convex_exit_migration_batches` (`id`) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `soul_version_snapshots` (
  `id` VARCHAR(36) NOT NULL,
  `soulSnapshotId` VARCHAR(36) NOT NULL,
  `legacyConvexId` VARCHAR(191) NOT NULL,
  `semanticVersion` VARCHAR(191) NOT NULL,
  `fingerprint` CHAR(64) NULL,
  `changelog` TEXT NOT NULL,
  `changelogSource` VARCHAR(32) NULL,
  `parsedMetadata` JSON NOT NULL,
  `createdByUserLegacyConvexId` VARCHAR(191) NOT NULL,
  `legacyCreatedAt` DATETIME(3) NOT NULL,
  `softDeletedAt` DATETIME(3) NULL,
  `sourceHash` CHAR(64) NOT NULL,
  `lastSeenBatchId` VARCHAR(36) NOT NULL,
  `sourceMissingAt` DATETIME(3) NULL,
  `syncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `soul_version_snapshots_legacy_key` (`legacyConvexId`),
  UNIQUE KEY `soul_version_snapshots_version_key` (`soulSnapshotId`, `semanticVersion`),
  KEY `soul_version_snapshots_active_created_idx` (`soulSnapshotId`, `softDeletedAt`, `legacyCreatedAt`),
  KEY `soul_version_snapshots_seen_idx` (`lastSeenBatchId`, `sourceMissingAt`),
  CONSTRAINT `soul_version_snapshots_soul_fk`
    FOREIGN KEY (`soulSnapshotId`) REFERENCES `soul_snapshots` (`id`) ON DELETE CASCADE,
  CONSTRAINT `soul_version_snapshots_batch_fk`
    FOREIGN KEY (`lastSeenBatchId`) REFERENCES `convex_exit_migration_batches` (`id`) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `soul_version_file_snapshots` (
  `id` VARCHAR(36) NOT NULL,
  `soulVersionSnapshotId` VARCHAR(36) NOT NULL,
  `legacyStorageId` VARCHAR(191) NULL,
  `path` VARCHAR(1024) NOT NULL,
  `mimeType` VARCHAR(255) NULL,
  `sizeBytes` BIGINT NOT NULL,
  `sha256` CHAR(64) NOT NULL,
  `targetAssetId` VARCHAR(36) NULL,
  `assetReferenceState` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `assetReferenceUpdatedAt` DATETIME(3) NULL,
  `sourceHash` CHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `soul_version_file_snapshots_path_key` (`soulVersionSnapshotId`, `path`(700)),
  UNIQUE KEY `soul_version_file_snapshots_storage_key` (`legacyStorageId`),
  UNIQUE KEY `soul_version_file_snapshots_hash_key` (`soulVersionSnapshotId`, `sha256`),
  KEY `soul_version_file_snapshots_asset_idx` (`assetReferenceState`, `targetAssetId`),
  CONSTRAINT `soul_version_file_snapshots_version_fk`
    FOREIGN KEY (`soulVersionSnapshotId`) REFERENCES `soul_version_snapshots` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;