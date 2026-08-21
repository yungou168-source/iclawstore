-- AI Direct provider execution contract.
-- Additive only: encrypted credential metadata, explicit provider catalog mapping,
-- retry state, and idempotent model execution audits.
--
-- The P0 catalog/audit/credential tables predate the checked-in migration chain.
-- Define their pre-provider-runtime shape so a fresh database can apply this migration;
-- CREATE TABLE IF NOT EXISTS is a no-op for existing deployments.

CREATE TABLE IF NOT EXISTS `ai_direct_model_catalog` (
  `id` VARCHAR(36) NOT NULL,
  `modelKey` VARCHAR(255) NOT NULL,
  `displayName` VARCHAR(255) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `capabilities` JSON NULL,
  `taskProfile` JSON NULL,
  `evidenceVersion` VARCHAR(128) NULL,
  `evidence` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_direct_model_catalog_modelKey_key`(`modelKey`),
  INDEX `ai_direct_model_catalog_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_direct_model_run_audits` (
  `id` VARCHAR(36) NOT NULL,
  `agentId` VARCHAR(36) NOT NULL,
  `agentVersionId` VARCHAR(36) NOT NULL,
  `catalogModelId` VARCHAR(36) NOT NULL,
  `modelKey` VARCHAR(255) NOT NULL,
  `taskType` VARCHAR(128) NULL,
  `status` VARCHAR(32) NOT NULL,
  `failureCode` VARCHAR(128) NULL,
  `inputTokens` INTEGER NULL,
  `outputTokens` INTEGER NULL,
  `costMicros` BIGINT NULL,
  `latencyMs` INTEGER NULL,
  `routingMetadata` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `ai_direct_model_run_audits_agentId_createdAt_idx`(`agentId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_direct_user_credentials` (
  `id` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(64) NOT NULL DEFAULT 'jinsha-token',
  `cipherText` MEDIUMTEXT NOT NULL,
  `iv` VARCHAR(64) NOT NULL,
  `authTag` VARCHAR(64) NOT NULL,
  `keyVersion` VARCHAR(32) NOT NULL DEFAULT 'v1',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `revokedAt` DATETIME(3) NULL,
  UNIQUE INDEX `ai_direct_user_credentials_userId_provider_key`(`userId`, `provider`),
  INDEX `ai_direct_user_credentials_userId_idx`(`userId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_direct_user_credentials`
  ADD COLUMN `label` VARCHAR(160) NOT NULL DEFAULT '金沙' AFTER `provider`,
  ADD COLUMN `fingerprint` CHAR(64) NULL AFTER `label`,
  ADD COLUMN `credentialVersion` INTEGER NOT NULL DEFAULT 1 AFTER `keyVersion`,
  ADD COLUMN `validationStatus` VARCHAR(32) NOT NULL DEFAULT 'unvalidated' AFTER `credentialVersion`,
  ADD COLUMN `validatedAt` DATETIME(3) NULL AFTER `validationStatus`,
  ADD COLUMN `lastUsedAt` DATETIME(3) NULL AFTER `validatedAt`,
  ADD INDEX `ai_direct_user_credentials_validationStatus_updatedAt_idx`(`validationStatus`, `updatedAt`);

ALTER TABLE `ai_direct_model_catalog`
  ADD COLUMN `providerKey` VARCHAR(64) NULL AFTER `modelKey`,
  ADD COLUMN `providerModelKey` VARCHAR(255) NULL AFTER `providerKey`,
  ADD COLUMN `pricing` JSON NULL AFTER `taskProfile`,
  ADD UNIQUE INDEX `ai_direct_model_catalog_providerKey_providerModelKey_key`(`providerKey`, `providerModelKey`),
  ADD INDEX `ai_direct_model_catalog_providerKey_status_idx`(`providerKey`, `status`);

ALTER TABLE `ai_direct_workflow_run_steps`
  ADD COLUMN `attemptCount` INTEGER NOT NULL DEFAULT 0 AFTER `status`,
  ADD COLUMN `maxAttempts` INTEGER NOT NULL DEFAULT 3 AFTER `attemptCount`,
  ADD COLUMN `lastFailureClass` VARCHAR(64) NULL AFTER `failureCode`;

ALTER TABLE `ai_direct_model_run_audits`
  ADD COLUMN `runId` VARCHAR(36) NULL AFTER `id`,
  ADD COLUMN `stepId` VARCHAR(36) NULL AFTER `runId`,
  ADD COLUMN `providerKey` VARCHAR(64) NULL AFTER `modelKey`,
  ADD COLUMN `credentialVersion` INTEGER NULL AFTER `providerKey`,
  ADD COLUMN `providerRequestId` VARCHAR(191) NULL AFTER `credentialVersion`,
  ADD COLUMN `attempt` INTEGER NOT NULL DEFAULT 1 AFTER `providerRequestId`,
  ADD COLUMN `failureClass` VARCHAR(64) NULL AFTER `failureCode`,
  ADD UNIQUE INDEX `ai_direct_model_run_audits_stepId_attempt_key`(`stepId`, `attempt`),
  ADD INDEX `ai_direct_model_run_audits_runId_createdAt_idx`(`runId`, `createdAt`),
  ADD INDEX `ai_direct_model_run_audits_stepId_createdAt_idx`(`stepId`, `createdAt`),
  ADD INDEX `ai_direct_model_run_audits_providerKey_createdAt_idx`(`providerKey`, `createdAt`);