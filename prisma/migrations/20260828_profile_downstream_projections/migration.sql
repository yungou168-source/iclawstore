-- Expand-only public profile downstream projection.
-- This migration creates no write authority and does not activate MySQL reads.

CREATE TABLE `profile_catalog_items` (
  `id` VARCHAR(36) NOT NULL,
  `publisherId` VARCHAR(36) NOT NULL,
  `legacyConvexId` VARCHAR(191) NOT NULL,
  `kind` VARCHAR(16) NOT NULL,
  `slug` VARCHAR(191) NULL,
  `displayName` VARCHAR(191) NOT NULL,
  `summary` TEXT NULL,
  `icon` VARCHAR(512) NULL,
  `ownerHandle` VARCHAR(40) NOT NULL,
  `isOfficial` BOOLEAN NOT NULL DEFAULT FALSE,
  `downloads` BIGINT NOT NULL DEFAULT 0,
  `stars` BIGINT NOT NULL DEFAULT 0,
  `sourceGitHubId` VARCHAR(191) NULL,
  `sourceRepo` VARCHAR(512) NULL,
  `sourcePath` VARCHAR(1024) NULL,
  `sourceVerifiedCommit` VARCHAR(191) NULL,
  `visibleAt` DATETIME(3) NULL,
  `deletedAt` DATETIME(3) NULL,
  `legacyUpdatedAt` DATETIME(3) NOT NULL,
  `sourceHash` CHAR(64) NOT NULL,
  `lastSeenBatchId` VARCHAR(36) NOT NULL,
  `sourceMissingAt` DATETIME(3) NULL,
  `syncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `profile_catalog_items_legacy_convex_id_key` (`legacyConvexId`),
  UNIQUE KEY `profile_catalog_items_publisher_item_key` (`publisherId`, `legacyConvexId`),
  UNIQUE KEY `profile_catalog_items_publisher_target_key` (`publisherId`, `id`),
  KEY `profile_catalog_items_public_page_idx` (`publisherId`, `kind`, `deletedAt`, `visibleAt`, `downloads`, `legacyUpdatedAt`),
  KEY `profile_catalog_items_source_idx` (`sourceGitHubId`, `legacyUpdatedAt`),
  KEY `profile_catalog_items_seen_batch_idx` (`lastSeenBatchId`, `sourceMissingAt`),
  CONSTRAINT `profile_catalog_items_publisher_fk`
    FOREIGN KEY (`publisherId`) REFERENCES `publisher_snapshots` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `profile_starred_items` (
  `id` VARCHAR(36) NOT NULL,
  `viewerProfileId` VARCHAR(36) NOT NULL,
  `viewerUserLegacyConvexId` VARCHAR(191) NOT NULL,
  `skillLegacyConvexId` VARCHAR(191) NOT NULL,
  `ownerPublisherLegacyConvexId` VARCHAR(191) NULL,
  `ownerHandle` VARCHAR(40) NOT NULL,
  `displayName` VARCHAR(191) NOT NULL,
  `summary` TEXT NULL,
  `icon` VARCHAR(512) NULL,
  `isOfficial` BOOLEAN NOT NULL DEFAULT FALSE,
  `downloads` BIGINT NOT NULL DEFAULT 0,
  `stars` BIGINT NOT NULL DEFAULT 0,
  `starredAt` DATETIME(3) NOT NULL,
  `skillUpdatedAt` DATETIME(3) NOT NULL,
  `visibleAt` DATETIME(3) NULL,
  `deletedAt` DATETIME(3) NULL,
  `sourceHash` CHAR(64) NOT NULL,
  `lastSeenBatchId` VARCHAR(36) NOT NULL,
  `sourceMissingAt` DATETIME(3) NULL,
  `syncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `profile_starred_items_viewer_skill_key` (`viewerUserLegacyConvexId`, `skillLegacyConvexId`),
  KEY `profile_starred_items_public_page_idx` (`viewerProfileId`, `deletedAt`, `visibleAt`, `starredAt`, `downloads`),
  KEY `profile_starred_items_seen_batch_idx` (`lastSeenBatchId`, `sourceMissingAt`),
  CONSTRAINT `profile_starred_items_viewer_profile_fk`
    FOREIGN KEY (`viewerProfileId`) REFERENCES `profile_snapshots` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `profile_catalog_manifests` (
  `id` VARCHAR(36) NOT NULL,
  `publisherId` VARCHAR(36) NOT NULL,
  `sourceGitHubLegacyConvexId` VARCHAR(191) NOT NULL,
  `repo` VARCHAR(512) NOT NULL,
  `status` VARCHAR(16) NOT NULL,
  `manifestHash` CHAR(64) NULL,
  `verifiedCommit` VARCHAR(191) NULL,
  `notGrouped` VARCHAR(16) NULL,
  `legacyUpdatedAt` DATETIME(3) NOT NULL,
  `sourceHash` CHAR(64) NOT NULL,
  `lastSeenBatchId` VARCHAR(36) NOT NULL,
  `sourceMissingAt` DATETIME(3) NULL,
  `syncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `profile_catalog_manifests_source_key` (`sourceGitHubLegacyConvexId`),
  UNIQUE KEY `profile_catalog_manifests_publisher_target_key` (`publisherId`, `id`),
  KEY `profile_catalog_manifests_publisher_idx` (`publisherId`, `status`, `legacyUpdatedAt`),
  KEY `profile_catalog_manifests_seen_batch_idx` (`lastSeenBatchId`, `sourceMissingAt`),
  CONSTRAINT `profile_catalog_manifests_publisher_fk`
    FOREIGN KEY (`publisherId`) REFERENCES `publisher_snapshots` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `profile_catalog_manifest_sections` (
  `id` VARCHAR(36) NOT NULL,
  `manifestId` VARCHAR(36) NOT NULL,
  `publisherId` VARCHAR(36) NOT NULL,
  `position` INTEGER NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `profile_catalog_manifest_sections_position_key` (`manifestId`, `position`),
  UNIQUE KEY `profile_catalog_manifest_sections_publisher_target_key` (`publisherId`, `id`),
  CONSTRAINT `profile_catalog_manifest_sections_manifest_fk`
    FOREIGN KEY (`publisherId`, `manifestId`) REFERENCES `profile_catalog_manifests` (`publisherId`, `id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `profile_catalog_manifest_entries` (
  `id` VARCHAR(36) NOT NULL,
  `sectionId` VARCHAR(36) NOT NULL,
  `publisherId` VARCHAR(36) NOT NULL,
  `catalogItemId` VARCHAR(36) NOT NULL,
  `position` INTEGER NOT NULL,
  `manifestSkillKey` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `profile_catalog_manifest_entries_position_key` (`sectionId`, `position`),
  UNIQUE KEY `profile_catalog_manifest_entries_item_key` (`sectionId`, `catalogItemId`),
  KEY `profile_catalog_manifest_entries_publisher_idx` (`publisherId`),
  CONSTRAINT `profile_catalog_manifest_entries_section_fk`
    FOREIGN KEY (`publisherId`, `sectionId`) REFERENCES `profile_catalog_manifest_sections` (`publisherId`, `id`) ON DELETE CASCADE,
  CONSTRAINT `profile_catalog_manifest_entries_catalog_item_fk`
    FOREIGN KEY (`publisherId`, `catalogItemId`) REFERENCES `profile_catalog_items` (`publisherId`, `id`) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;