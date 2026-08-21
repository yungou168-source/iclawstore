-- P1 expand-only Skill/Package fact snapshots.
-- Inactive: no routes, workers, source reads, or writes are registered.

CREATE TABLE IF NOT EXISTS `skill_package_alias_facts` (
  `id` VARCHAR(36) NOT NULL,
  `snapshotId` VARCHAR(36) NOT NULL,
  `legacyConvexId` VARCHAR(191) NOT NULL,
  `aliasKind` VARCHAR(32) NOT NULL,
  `aliasValue` VARCHAR(255) NOT NULL,
  `isCanonical` BOOLEAN NOT NULL DEFAULT FALSE,
  `retiredAt` DATETIME(3) NULL,
  `sourceHash` CHAR(64) NOT NULL,
  `lastSeenBatchId` VARCHAR(36) NOT NULL,
  `sourceMissingAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `skill_package_alias_fact_key` (`snapshotId`, `aliasKind`, `aliasValue`),
  KEY `skill_package_alias_lookup_idx` (`aliasValue`, `aliasKind`),
  CONSTRAINT `skill_package_alias_fact_snapshot_fk` FOREIGN KEY (`snapshotId`) REFERENCES `skill_package_snapshots` (`id`) ON DELETE CASCADE,
  CONSTRAINT `skill_package_alias_fact_batch_fk` FOREIGN KEY (`lastSeenBatchId`) REFERENCES `convex_exit_migration_batches` (`id`) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `skill_package_github_facts` (
  `id` VARCHAR(36) NOT NULL,
  `snapshotId` VARCHAR(36) NOT NULL,
  `sourceLegacyConvexId` VARCHAR(191) NULL,
  `repository` VARCHAR(512) NULL,
  `path` VARCHAR(1024) NULL,
  `commit` VARCHAR(191) NULL,
  `contentHash` CHAR(64) NULL,
  `status` VARCHAR(32) NULL,
  `sourceHash` CHAR(64) NOT NULL,
  `lastSeenBatchId` VARCHAR(36) NOT NULL,
  `sourceMissingAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), UNIQUE KEY `skill_package_github_fact_snapshot_key` (`snapshotId`),
  KEY `skill_package_github_fact_source_idx` (`repository`, `commit`),
  CONSTRAINT `skill_package_github_fact_snapshot_fk` FOREIGN KEY (`snapshotId`) REFERENCES `skill_package_snapshots` (`id`) ON DELETE CASCADE,
  CONSTRAINT `skill_package_github_fact_batch_fk` FOREIGN KEY (`lastSeenBatchId`) REFERENCES `convex_exit_migration_batches` (`id`) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `skill_package_ownership_facts` (
  `id` VARCHAR(36) NOT NULL, `snapshotId` VARCHAR(36) NOT NULL, `legacyConvexId` VARCHAR(191) NOT NULL,
  `ownerUserLegacyConvexId` VARCHAR(191) NULL, `ownerPublisherLegacyConvexId` VARCHAR(191) NULL,
  `eventKind` VARCHAR(32) NOT NULL, `effectiveAt` DATETIME(3) NOT NULL, `actorUserLegacyConvexId` VARCHAR(191) NULL,
  `sourceHash` CHAR(64) NOT NULL, `lastSeenBatchId` VARCHAR(36) NOT NULL, `sourceMissingAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE KEY `skill_package_ownership_fact_key` (`snapshotId`, `legacyConvexId`),
  KEY `skill_package_ownership_fact_owner_idx` (`ownerPublisherLegacyConvexId`, `effectiveAt`),
  CONSTRAINT `skill_package_ownership_fact_snapshot_fk` FOREIGN KEY (`snapshotId`) REFERENCES `skill_package_snapshots` (`id`) ON DELETE CASCADE,
  CONSTRAINT `skill_package_ownership_fact_batch_fk` FOREIGN KEY (`lastSeenBatchId`) REFERENCES `convex_exit_migration_batches` (`id`) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `skill_package_version_file_facts` (
  `id` VARCHAR(36) NOT NULL, `versionSnapshotId` VARCHAR(36) NOT NULL, `path` VARCHAR(1024) NOT NULL,
  `sizeBytes` BIGINT NOT NULL, `mimeType` VARCHAR(255) NOT NULL, `sha256` CHAR(64) NOT NULL,
  `storageLegacyConvexId` VARCHAR(191) NULL, `sourceHash` CHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE KEY `skill_package_version_file_fact_key` (`versionSnapshotId`, `path`(700)), KEY `skill_package_version_file_fact_sha_idx` (`sha256`),
  CONSTRAINT `skill_package_version_file_fact_version_fk` FOREIGN KEY (`versionSnapshotId`) REFERENCES `skill_package_version_snapshots` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `package_publish_token_facts` (
  `id` VARCHAR(36) NOT NULL, `snapshotId` VARCHAR(36) NOT NULL, `legacyConvexId` VARCHAR(191) NOT NULL,
  `tokenHash` VARCHAR(255) NOT NULL, `provider` VARCHAR(64) NOT NULL, `repository` VARCHAR(512) NOT NULL,
  `workflowFilename` VARCHAR(512) NOT NULL, `expiresAt` DATETIME(3) NOT NULL, `lastUsedAt` DATETIME(3) NULL, `revokedAt` DATETIME(3) NULL,
  `sourceHash` CHAR(64) NOT NULL, `lastSeenBatchId` VARCHAR(36) NOT NULL, `sourceMissingAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), UNIQUE KEY `package_publish_token_fact_legacy_key` (`legacyConvexId`), KEY `package_publish_token_fact_state_idx` (`snapshotId`, `revokedAt`, `expiresAt`),
  CONSTRAINT `package_publish_token_fact_snapshot_fk` FOREIGN KEY (`snapshotId`) REFERENCES `skill_package_snapshots` (`id`) ON DELETE CASCADE,
  CONSTRAINT `package_publish_token_fact_batch_fk` FOREIGN KEY (`lastSeenBatchId`) REFERENCES `convex_exit_migration_batches` (`id`) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `package_publish_upload_ticket_facts` (
  `id` VARCHAR(36) NOT NULL, `snapshotId` VARCHAR(36) NOT NULL, `legacyConvexId` VARCHAR(191) NOT NULL,
  `kind` VARCHAR(32) NOT NULL, `publishTokenLegacyConvexId` VARCHAR(191) NULL, `userLegacyConvexId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL, `expiresAt` DATETIME(3) NOT NULL, `usedAt` DATETIME(3) NULL, `storageLegacyConvexId` VARCHAR(191) NULL,
  `sourceHash` CHAR(64) NOT NULL, `lastSeenBatchId` VARCHAR(36) NOT NULL, `sourceMissingAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`), UNIQUE KEY `package_upload_ticket_fact_legacy_key` (`legacyConvexId`), KEY `package_upload_ticket_fact_state_idx` (`snapshotId`, `expiresAt`, `usedAt`),
  CONSTRAINT `package_upload_ticket_fact_snapshot_fk` FOREIGN KEY (`snapshotId`) REFERENCES `skill_package_snapshots` (`id`) ON DELETE CASCADE,
  CONSTRAINT `package_upload_ticket_fact_batch_fk` FOREIGN KEY (`lastSeenBatchId`) REFERENCES `convex_exit_migration_batches` (`id`) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `package_trusted_publisher_facts` (
  `id` VARCHAR(36) NOT NULL, `snapshotId` VARCHAR(36) NOT NULL, `legacyConvexId` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(64) NOT NULL, `repository` VARCHAR(512) NOT NULL, `repositoryId` VARCHAR(191) NOT NULL,
  `workflowFilename` VARCHAR(512) NOT NULL, `environment` VARCHAR(255) NULL, `sourceHash` CHAR(64) NOT NULL,
  `lastSeenBatchId` VARCHAR(36) NOT NULL, `sourceMissingAt` DATETIME(3) NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY `package_trusted_publisher_fact_legacy_key` (`legacyConvexId`), KEY `package_trusted_publisher_fact_repo_idx` (`repository`, `workflowFilename`(255)),
  CONSTRAINT `package_trusted_publisher_fact_snapshot_fk` FOREIGN KEY (`snapshotId`) REFERENCES `skill_package_snapshots` (`id`) ON DELETE CASCADE,
  CONSTRAINT `package_trusted_publisher_fact_batch_fk` FOREIGN KEY (`lastSeenBatchId`) REFERENCES `convex_exit_migration_batches` (`id`) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `package_inspector_facts` (
  `id` VARCHAR(36) NOT NULL, `snapshotId` VARCHAR(36) NOT NULL, `legacyConvexId` VARCHAR(191) NOT NULL, `releaseLegacyConvexId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(32) NOT NULL, `inspectorVersion` VARCHAR(255) NULL, `targetRuntimeVersion` VARCHAR(255) NULL, `findingCount` INT NOT NULL, `findingsHash` CHAR(64) NULL,
  `observedAt` DATETIME(3) NOT NULL, `sourceHash` CHAR(64) NOT NULL, `lastSeenBatchId` VARCHAR(36) NOT NULL, `sourceMissingAt` DATETIME(3) NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), UNIQUE KEY `package_inspector_fact_legacy_key` (`legacyConvexId`), KEY `package_inspector_fact_release_idx` (`releaseLegacyConvexId`, `observedAt`),
  CONSTRAINT `package_inspector_fact_snapshot_fk` FOREIGN KEY (`snapshotId`) REFERENCES `skill_package_snapshots` (`id`) ON DELETE CASCADE,
  CONSTRAINT `package_inspector_fact_batch_fk` FOREIGN KEY (`lastSeenBatchId`) REFERENCES `convex_exit_migration_batches` (`id`) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;