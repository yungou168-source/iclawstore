CREATE TABLE IF NOT EXISTS `ai_direct_agents` (
  `id` VARCHAR(36) NOT NULL,
  `ownerUserId` VARCHAR(191) NOT NULL,
  `ownerPublisherId` VARCHAR(191) NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `activeVersionId` VARCHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX `ai_direct_agents_ownerUserId_idx` (`ownerUserId`),
  INDEX `ai_direct_agents_ownerPublisherId_idx` (`ownerPublisherId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_direct_agent_versions` (
  `id` VARCHAR(36) NOT NULL,
  `agentId` VARCHAR(36) NOT NULL,
  `version` INTEGER NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `promptSpec` JSON NOT NULL,
  `modelPolicy` JSON NOT NULL,
  `executionPolicy` JSON NOT NULL,
  `createdByUserId` VARCHAR(191) NOT NULL,
  `publishedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_direct_agent_versions_agentId_version_key` (`agentId`, `version`),
  INDEX `ai_direct_agent_versions_agentId_idx` (`agentId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_direct_employments`
  ADD COLUMN `requestedByUserId` VARCHAR(191) NULL AFTER `offerId`,
  ADD UNIQUE INDEX `ai_direct_employments_offerId_key` (`offerId`),
  ADD INDEX `ai_direct_employments_requestedByUserId_status_idx` (`requestedByUserId`, `status`);