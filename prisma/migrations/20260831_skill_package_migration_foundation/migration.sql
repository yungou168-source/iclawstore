-- Expand-only Skill/Package migration snapshots.
-- No runtime route, reader, writer, or asset copy is activated by this migration.

CREATE TABLE IF NOT EXISTS `skill_package_snapshots` (
  `id` VARCHAR(36) NOT NULL,
  `domain` VARCHAR(16) NOT NULL,
  `legacyConvexId` VARCHAR(191) NOT NULL,
  `ownerPublisherLegacyConvexId` VARCHAR(191) NULL,
  `canonicalName` VARCHAR(255) NOT NULL,
  `displayName` VARCHAR(255) NOT NULL,
  `summary` TEXT NULL,
  `visibility` VARCHAR(32) NOT NULL,
  `metadata` JSON NOT NULL,
  `legacyUpdatedAt` DATETIME(3) NOT NULL,
  `sourceHash` CHAR(64) NOT NULL,
  `lastSeenBatchId` VARCHAR(36) NOT NULL,
  `sourceMissingAt` DATETIME(3) NULL,
  `syncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `skill_package_snapshots_legacy_key` (`domain`, `legacyConvexId`),
  UNIQUE KEY `skill_package_snapshots_name_key` (`domain`, `canonicalName`),
  KEY `skill_package_snapshots_owner_idx` (`ownerPublisherLegacyConvexId`, `visibility`),
  KEY `skill_package_snapshots_seen_idx` (`lastSeenBatchId`, `sourceMissingAt`),
  CONSTRAINT `skill_package_snapshots_batch_fk`
    FOREIGN KEY (`lastSeenBatchId`) REFERENCES `convex_exit_migration_batches` (`id`) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `skill_package_version_snapshots` (
  `id` VARCHAR(36) NOT NULL,
  `snapshotId` VARCHAR(36) NOT NULL,
  `legacyConvexId` VARCHAR(191) NOT NULL,
  `semanticVersion` VARCHAR(191) NOT NULL,
  `sourceHash` CHAR(64) NOT NULL,
  `sourceMetadata` JSON NOT NULL,
  `scanSnapshot` JSON NULL,
  `legacyCreatedAt` DATETIME(3) NOT NULL,
  `legacyUpdatedAt` DATETIME(3) NOT NULL,
  `lastSeenBatchId` VARCHAR(36) NOT NULL,
  `sourceMissingAt` DATETIME(3) NULL,
  `syncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `skill_package_versions_legacy_key` (`legacyConvexId`),
  UNIQUE KEY `skill_package_versions_version_key` (`snapshotId`, `semanticVersion`),
  KEY `skill_package_versions_seen_idx` (`lastSeenBatchId`, `sourceMissingAt`),
  CONSTRAINT `skill_package_versions_snapshot_fk`
    FOREIGN KEY (`snapshotId`) REFERENCES `skill_package_snapshots` (`id`) ON DELETE CASCADE,
  CONSTRAINT `skill_package_versions_batch_fk`
    FOREIGN KEY (`lastSeenBatchId`) REFERENCES `convex_exit_migration_batches` (`id`) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `skill_package_artifact_snapshots` (
  `id` VARCHAR(36) NOT NULL,
  `versionSnapshotId` VARCHAR(36) NOT NULL,
  `legacyStorageId` VARCHAR(191) NULL,
  `path` VARCHAR(1024) NOT NULL,
  `mimeType` VARCHAR(255) NOT NULL,
  `sizeBytes` BIGINT NOT NULL,
  `sha256` CHAR(64) NOT NULL,
  `copyStatus` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `targetAssetId` VARCHAR(36) NULL,
  `claimToken` VARCHAR(36) NULL,
  `claimExpiresAt` DATETIME(3) NULL,
  `failureCode` VARCHAR(128) NULL,
  `sourceHash` CHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `skill_package_artifacts_version_path_key` (`versionSnapshotId`, `path`(700)),
  UNIQUE KEY `skill_package_artifacts_storage_key` (`legacyStorageId`),
  UNIQUE KEY `skill_package_artifacts_sha256_key` (`versionSnapshotId`, `sha256`),
  KEY `skill_package_artifacts_copy_idx` (`copyStatus`, `claimExpiresAt`),
  CONSTRAINT `skill_package_artifacts_version_fk`
    FOREIGN KEY (`versionSnapshotId`) REFERENCES `skill_package_version_snapshots` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;