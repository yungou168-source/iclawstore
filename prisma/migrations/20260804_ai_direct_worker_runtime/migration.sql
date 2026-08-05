-- AI Direct worker runtime security, artifact metadata, and lightweight operations.
-- Additive only. Token plaintext and artifact file contents are never stored.

CREATE TABLE IF NOT EXISTS `ai_direct_worker_tokens` (
  `id` VARCHAR(36) NOT NULL,
  `organizationId` VARCHAR(36) NOT NULL,
  `workerId` VARCHAR(128) NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `tokenPrefix` VARCHAR(16) NOT NULL,
  `tokenHash` CHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `expiresAt` DATETIME(3) NULL,
  `lastUsedAt` DATETIME(3) NULL,
  `revokedAt` DATETIME(3) NULL,
  `createdByUserId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_direct_worker_tokens_tokenHash_key`(`tokenHash`),
  INDEX `ai_direct_worker_tokens_organizationId_status_idx`(`organizationId`, `status`),
  INDEX `ai_direct_worker_tokens_workerId_status_idx`(`workerId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_direct_artifacts` (
  `id` VARCHAR(36) NOT NULL,
  `organizationId` VARCHAR(36) NOT NULL,
  `runId` VARCHAR(36) NOT NULL,
  `stepId` VARCHAR(36) NULL,
  `kind` VARCHAR(64) NOT NULL,
  `storagePath` VARCHAR(1024) NOT NULL,
  `storagePathHash` CHAR(64) NOT NULL,
  `mimeType` VARCHAR(255) NOT NULL,
  `sizeBytes` BIGINT NOT NULL,
  `sha256` CHAR(64) NOT NULL,
  `visibility` VARCHAR(32) NOT NULL DEFAULT 'organization',
  `createdByWorkerId` VARCHAR(128) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_direct_artifacts_runId_storagePathHash_key`(`runId`, `storagePathHash`),
  INDEX `ai_direct_artifacts_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
  INDEX `ai_direct_artifacts_runId_createdAt_idx`(`runId`, `createdAt`),
  INDEX `ai_direct_artifacts_stepId_idx`(`stepId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_direct_runtime_metrics` (
  `metricKey` VARCHAR(128) NOT NULL,
  `metricValue` BIGINT NOT NULL DEFAULT 0,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`metricKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_direct_workflow_runs`
  ADD COLUMN `lastHeartbeatAt` DATETIME(3) NULL AFTER `leaseExpiresAt`;