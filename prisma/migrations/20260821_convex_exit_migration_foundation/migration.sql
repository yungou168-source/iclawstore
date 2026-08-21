-- Expand-only control-plane tables for the Convex exit program.
-- This migration creates no data path, worker, or production cutover. Each domain
-- remains Convex-authoritative until its separately approved migration gate passes.

CREATE TABLE `convex_exit_migration_batches` (
  `id` VARCHAR(36) NOT NULL,
  `domain` VARCHAR(64) NOT NULL,
  `source` VARCHAR(128) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `approvalRef` VARCHAR(191) NULL,
  `requestedBy` VARCHAR(191) NULL,
  `sourceCursor` TEXT NULL,
  `sourceCount` BIGINT NULL,
  `upsertedCount` BIGINT NOT NULL DEFAULT 0,
  `unchangedCount` BIGINT NOT NULL DEFAULT 0,
  `errorCount` BIGINT NOT NULL DEFAULT 0,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completedAt` DATETIME(3) NULL,
  `failedAt` DATETIME(3) NULL,
  `failureCode` VARCHAR(128) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `convex_exit_batches_domain_status_idx` (`domain`, `status`, `startedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `convex_exit_legacy_id_maps` (
  `domain` VARCHAR(64) NOT NULL,
  `legacyConvexId` VARCHAR(191) NOT NULL,
  `targetId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`domain`, `legacyConvexId`),
  UNIQUE KEY `convex_exit_legacy_target_key` (`domain`, `targetId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `convex_exit_reconciliation_records` (
  `id` VARCHAR(36) NOT NULL,
  `recordKey` CHAR(64) NOT NULL,
  `domain` VARCHAR(64) NOT NULL,
  `batchId` VARCHAR(36) NULL,
  `legacyConvexId` VARCHAR(191) NOT NULL,
  `fieldName` VARCHAR(128) NOT NULL,
  `differenceKind` VARCHAR(64) NOT NULL,
  `classification` VARCHAR(64) NOT NULL DEFAULT 'unclassified',
  `summary` VARCHAR(512) NOT NULL,
  `observedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `resolvedAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `convex_exit_reconciliation_key` (`recordKey`),
  KEY `convex_exit_reconciliation_domain_legacy_idx` (`domain`, `legacyConvexId`, `observedAt`),
  KEY `convex_exit_reconciliation_gate_idx` (`domain`, `classification`, `resolvedAt`),
  CONSTRAINT `convex_exit_reconciliation_batch_fk`
    FOREIGN KEY (`batchId`) REFERENCES `convex_exit_migration_batches` (`id`) ON DELETE SET NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `convex_exit_managed_assets` (
  `id` VARCHAR(36) NOT NULL,
  `legacyStorageId` VARCHAR(191) NULL,
  `ownerDomain` VARCHAR(64) NOT NULL,
  `ownerLegacyConvexId` VARCHAR(191) NOT NULL,
  `accessScope` VARCHAR(32) NOT NULL,
  `storageKey` VARCHAR(191) NOT NULL,
  `originalFileName` VARCHAR(512) NULL,
  `mimeType` VARCHAR(255) NOT NULL,
  `sizeBytes` BIGINT NOT NULL,
  `sha256` CHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `convex_exit_assets_legacy_storage_key` (`legacyStorageId`),
  UNIQUE KEY `convex_exit_assets_storage_key` (`storageKey`),
  KEY `convex_exit_assets_owner_idx` (`ownerDomain`, `ownerLegacyConvexId`, `status`),
  KEY `convex_exit_assets_sha256_idx` (`sha256`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `convex_exit_outbox_events` (
  `id` VARCHAR(36) NOT NULL,
  `domain` VARCHAR(64) NOT NULL,
  `aggregateId` VARCHAR(191) NOT NULL,
  `aggregateVersion` BIGINT NOT NULL,
  `eventType` VARCHAR(128) NOT NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `payload` JSON NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `availableAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `claimedAt` DATETIME(3) NULL,
  `leaseExpiresAt` DATETIME(3) NULL,
  `publishedAt` DATETIME(3) NULL,
  `failedAt` DATETIME(3) NULL,
  `failureReason` TEXT NULL,
  `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `convex_exit_outbox_idempotency_key` (`idempotencyKey`),
  KEY `convex_exit_outbox_status_available_idx` (`status`, `availableAt`),
  KEY `convex_exit_outbox_lease_idx` (`status`, `leaseExpiresAt`),
  KEY `convex_exit_outbox_aggregate_idx` (`domain`, `aggregateId`, `aggregateVersion`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;