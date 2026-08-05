ALTER TABLE `ai_direct_agents`
  ADD COLUMN `catalogVisibility` VARCHAR(32) NOT NULL DEFAULT 'private' AFTER `status`,
  ADD COLUMN `availability` VARCHAR(32) NOT NULL DEFAULT 'unavailable' AFTER `catalogVisibility`,
  ADD COLUMN `categoryKey` VARCHAR(80) NULL AFTER `availability`,
  ADD COLUMN `catalogSummary` VARCHAR(500) NULL AFTER `categoryKey`,
  ADD COLUMN `capabilitySummary` JSON NULL AFTER `catalogSummary`,
  ADD COLUMN `appearanceAssetId` VARCHAR(36) NULL AFTER `capabilitySummary`,
  ADD COLUMN `priceStatus` VARCHAR(32) NOT NULL DEFAULT 'internal_use' AFTER `appearanceAssetId`,
  ADD COLUMN `idempotencyKey` VARCHAR(128) NULL AFTER `activeVersionId`,
  ADD COLUMN `idempotencyFingerprint` CHAR(64) NULL AFTER `idempotencyKey`,
  ADD UNIQUE INDEX `ai_direct_agents_ownerUserId_idempotencyKey_key` (`ownerUserId`, `idempotencyKey`),
  ADD INDEX `ai_direct_agents_catalogVisibility_availability_idx` (`catalogVisibility`, `availability`, `updatedAt`),
  ADD INDEX `ai_direct_agents_categoryKey_idx` (`categoryKey`);

ALTER TABLE `ai_direct_agent_versions`
  ADD COLUMN `reviewStatus` VARCHAR(32) NOT NULL DEFAULT 'draft' AFTER `status`,
  ADD COLUMN `securityStatus` VARCHAR(32) NOT NULL DEFAULT 'pending' AFTER `reviewStatus`,
  ADD COLUMN `reviewedByUserId` VARCHAR(191) NULL AFTER `securityStatus`,
  ADD COLUMN `reviewedAt` DATETIME(3) NULL AFTER `reviewedByUserId`,
  ADD COLUMN `idempotencyKey` VARCHAR(128) NULL AFTER `createdByUserId`,
  ADD COLUMN `idempotencyFingerprint` CHAR(64) NULL AFTER `idempotencyKey`,
  ADD UNIQUE INDEX `ai_direct_agent_versions_agentId_idempotencyKey_key` (`agentId`, `idempotencyKey`),
  ADD INDEX `ai_direct_agent_versions_reviewStatus_securityStatus_idx` (`reviewStatus`, `securityStatus`);

CREATE TABLE `ai_direct_candidate_catalog_digests` (
  `agentId` VARCHAR(36) NOT NULL,
  `agentVersionId` VARCHAR(36) NOT NULL,
  `displayName` VARCHAR(120) NOT NULL,
  `summary` VARCHAR(500) NULL,
  `categoryKey` VARCHAR(80) NULL,
  `capabilitySummary` JSON NOT NULL,
  `appearanceAssetId` VARCHAR(36) NULL,
  `availability` VARCHAR(32) NOT NULL,
  `priceStatus` VARCHAR(32) NOT NULL DEFAULT 'internal_use',
  `searchText` VARCHAR(800) NOT NULL,
  `sourceRevision` CHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`agentId`),
  UNIQUE INDEX `ai_direct_candidate_catalog_digests_agentVersionId_key` (`agentVersionId`),
  INDEX `ai_direct_candidate_catalog_digests_visibility_idx` (`availability`, `categoryKey`, `displayName`, `agentId`),
  INDEX `ai_direct_candidate_catalog_digests_category_idx` (`categoryKey`, `availability`),
  FULLTEXT INDEX `ai_direct_candidate_catalog_digests_searchText_ftx` (`searchText`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_direct_organization_candidate_catalog_counts` (
  `organizationId` VARCHAR(36) NOT NULL,
  `agentId` VARCHAR(36) NOT NULL,
  `isEmployed` BOOLEAN NOT NULL DEFAULT FALSE,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`organizationId`, `agentId`),
  INDEX `ai_direct_organization_candidate_catalog_counts_agentId_idx` (`agentId`, `isEmployed`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;