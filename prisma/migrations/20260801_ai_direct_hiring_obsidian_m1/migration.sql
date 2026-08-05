-- AI Direct Hiring — Obsidian memory bindings (M1)
-- Source of truth is MySQL. Raw notes never leave the device.
-- This migration is additive and idempotent (CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS `ai_direct_memory_bindings` (
  `id` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `vaultFingerprint` CHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `extractorVersion` VARCHAR(64) NOT NULL,
  `evidenceVersion` VARCHAR(64) NOT NULL,
  `noteCount` INT NOT NULL DEFAULT 0,
  `tagCount` INT NOT NULL DEFAULT 0,
  `lastSyncAt` DATETIME(3) NULL,
  `revokedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_direct_memory_bindings_userId_vaultFingerprint_key`(`userId`, `vaultFingerprint`),
  INDEX `ai_direct_memory_bindings_userId_status_idx`(`userId`, `status`),
  INDEX `ai_direct_memory_bindings_vaultFingerprint_idx`(`vaultFingerprint`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_direct_memory_digests` (
  `id` VARCHAR(36) NOT NULL,
  `bindingId` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `vaultFingerprint` CHAR(64) NOT NULL,
  `notePath` VARCHAR(1024) NOT NULL,
  `noteHash` CHAR(64) NOT NULL,
  `title` VARCHAR(512) NULL,
  `tagsJson` JSON NULL,
  `linksJson` JSON NULL,
  `summaryMd` TEXT NULL,
  `summaryBytes` INT NOT NULL DEFAULT 0,
  `sourceBytes` INT NOT NULL DEFAULT 0,
  `redactedAt` DATETIME(3) NULL,
  `redactionReason` VARCHAR(128) NULL,
  `frontmatterJson` JSON NULL,
  `mtime` DATETIME(3) NULL,
  `size` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_direct_memory_digests_bindingId_notePath_key`(`bindingId`, `notePath`(255)),
  INDEX `ai_direct_memory_digests_userId_vaultFingerprint_idx`(`userId`, `vaultFingerprint`),
  INDEX `ai_direct_memory_digests_bindingId_idx`(`bindingId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;