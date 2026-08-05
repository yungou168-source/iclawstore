-- AI Direct Hiring runtime contract repair.
-- Additive only: fills foundation tables and columns already required by runtime code.

CREATE TABLE IF NOT EXISTS `ai_direct_organizations` (
  `id` VARCHAR(36) NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `slug` VARCHAR(160) NOT NULL,
  `ownerUserId` VARCHAR(191) NOT NULL,
  `idempotencyKey` VARCHAR(128) NULL,
  `idempotencyFingerprint` CHAR(64) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_direct_organizations_slug_key`(`slug`),
  UNIQUE INDEX `ai_direct_organizations_ownerUserId_idempotencyKey_key`(`ownerUserId`, `idempotencyKey`),
  INDEX `ai_direct_organizations_ownerUserId_idx`(`ownerUserId`),
  INDEX `ai_direct_organizations_status_updatedAt_idx`(`status`, `updatedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_direct_organization_members` (
  `id` VARCHAR(36) NOT NULL,
  `organizationId` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `role` VARCHAR(32) NOT NULL DEFAULT 'member',
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `createdByUserId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_direct_organization_members_organizationId_userId_key`(`organizationId`, `userId`),
  INDEX `ai_direct_organization_members_userId_status_idx`(`userId`, `status`),
  INDEX `ai_direct_organization_members_organizationId_status_idx`(`organizationId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_direct_audit_events` (
  `id` VARCHAR(36) NOT NULL,
  `organizationId` VARCHAR(36) NULL,
  `actorUserId` VARCHAR(191) NULL,
  `action` VARCHAR(128) NOT NULL,
  `targetType` VARCHAR(64) NOT NULL,
  `targetId` VARCHAR(191) NOT NULL,
  `requestId` VARCHAR(128) NULL,
  `outcome` VARCHAR(32) NOT NULL,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `ai_direct_audit_events_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
  INDEX `ai_direct_audit_events_targetType_targetId_createdAt_idx`(`targetType`, `targetId`, `createdAt`),
  INDEX `ai_direct_audit_events_actorUserId_createdAt_idx`(`actorUserId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_direct_outbox_events` (
  `id` VARCHAR(36) NOT NULL,
  `organizationId` VARCHAR(36) NULL,
  `aggregateType` VARCHAR(64) NOT NULL,
  `aggregateId` VARCHAR(191) NOT NULL,
  `eventType` VARCHAR(128) NOT NULL,
  `payloadVersion` INTEGER NOT NULL DEFAULT 1,
  `payload` JSON NOT NULL,
  `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `availableAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `publishedAt` DATETIME(3) NULL,
  `failedAt` DATETIME(3) NULL,
  `failureReason` TEXT NULL,
  INDEX `ai_direct_outbox_events_status_availableAt_idx`(`status`, `availableAt`),
  INDEX `ai_direct_outbox_events_publishedAt_occurredAt_idx`(`publishedAt`, `occurredAt`),
  INDEX `ai_direct_outbox_events_aggregateType_aggregateId_occurredAt_idx`(`aggregateType`, `aggregateId`, `occurredAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_direct_company_members` (
  `id` VARCHAR(36) NOT NULL,
  `companyId` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `role` VARCHAR(32) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_direct_company_members_companyId_userId_key`(`companyId`, `userId`),
  INDEX `ai_direct_company_members_userId_status_idx`(`userId`, `status`),
  INDEX `ai_direct_company_members_companyId_status_role_idx`(`companyId`, `status`, `role`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_direct_workflow_runs`
  ADD COLUMN `runAfter` DATETIME(3) NULL AFTER `status`,
  ADD COLUMN `leaseOwner` VARCHAR(128) NULL AFTER `runAfter`,
  ADD COLUMN `leaseExpiresAt` DATETIME(3) NULL AFTER `leaseOwner`,
  ADD COLUMN `idempotencyKey` VARCHAR(128) NULL AFTER `requestedByUserId`,
  ADD UNIQUE INDEX `ai_direct_workflow_runs_requestedByUserId_idempotencyKey_key`(`requestedByUserId`, `idempotencyKey`),
  ADD INDEX `ai_direct_workflow_runs_queue_idx`(`status`, `runAfter`, `leaseExpiresAt`, `createdAt`),
  ADD INDEX `ai_direct_workflow_runs_leaseOwner_leaseExpiresAt_idx`(`leaseOwner`, `leaseExpiresAt`);