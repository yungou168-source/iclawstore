-- Agent appearance, desktop sidebar synchronization, and local-template catalog metadata.
-- The migration is additive. It deliberately stores only managed storage keys;
-- absolute server paths and client-local template business data are forbidden.

CREATE TABLE IF NOT EXISTS `ai_direct_agent_appearance_profiles` (
  `agentId` VARCHAR(36) NOT NULL,
  `avatarAssetId` VARCHAR(36) NULL,
  `defaultMode` VARCHAR(32) NOT NULL DEFAULT 'image_2d',
  `controllerEmploymentId` VARCHAR(36) NULL,
  `controllerCompanyId` VARCHAR(36) NULL,
  `revision` BIGINT NOT NULL DEFAULT 1,
  `updatedByUserId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `appearance_profiles_controller_employment_key` (`controllerEmploymentId`),
  INDEX `appearance_profiles_controller_company_idx` (`controllerCompanyId`),
  INDEX `appearance_profiles_updated_at_idx` (`updatedAt`),
  PRIMARY KEY (`agentId`),
  CONSTRAINT `appearance_profiles_default_mode_chk`
    CHECK (`defaultMode` IN ('image_2d', 'model_3d')),
  CONSTRAINT `appearance_profiles_controller_pair_chk`
    CHECK ((`controllerEmploymentId` IS NULL) = (`controllerCompanyId` IS NULL))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_direct_agent_appearance_assets` (
  `id` VARCHAR(36) NOT NULL,
  `agentId` VARCHAR(36) NOT NULL,
  `kind` VARCHAR(32) NOT NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `storageKey` VARCHAR(512) NOT NULL,
  `originalFileName` VARCHAR(255) NOT NULL,
  `mimeType` VARCHAR(128) NOT NULL,
  `sizeBytes` BIGINT NOT NULL,
  `sha256` CHAR(64) NOT NULL,
  `createdByUserId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `deletedByUserId` VARCHAR(191) NULL,
  `deletedAt` DATETIME(3) NULL,
  UNIQUE INDEX `appearance_assets_storage_key` (`storageKey`),
  INDEX `appearance_assets_agent_kind_status_order_idx` (`agentId`, `kind`, `status`, `sortOrder`),
  INDEX `appearance_assets_agent_status_created_idx` (`agentId`, `status`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `appearance_assets_kind_chk`
    CHECK (`kind` IN ('avatar', 'image_2d', 'model_3d')),
  CONSTRAINT `appearance_assets_status_chk`
    CHECK (`status` IN ('active', 'deleted')),
  CONSTRAINT `appearance_assets_size_chk` CHECK (`sizeBytes` >= 0),
  CONSTRAINT `appearance_assets_sort_order_chk` CHECK (`sortOrder` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_direct_agent_appearance_profiles`
  ADD CONSTRAINT `appearance_profiles_agent_fk`
  FOREIGN KEY (`agentId`) REFERENCES `ai_direct_agents` (`id`) ON DELETE CASCADE;

ALTER TABLE `ai_direct_agent_appearance_assets`
  ADD CONSTRAINT `appearance_assets_agent_fk`
  FOREIGN KEY (`agentId`) REFERENCES `ai_direct_agents` (`id`) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS `desktop_sidebar_preferences` (
  `userId` VARCHAR(191) NOT NULL,
  `config` JSON NOT NULL,
  `revision` BIGINT NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX `desktop_sidebar_preferences_updated_at_idx` (`updatedAt`),
  PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `desktop_sidebar_assets` (
  `id` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `storageKey` VARCHAR(512) NOT NULL,
  `originalFileName` VARCHAR(255) NOT NULL,
  `mimeType` VARCHAR(128) NOT NULL,
  `sizeBytes` BIGINT NOT NULL,
  `sha256` CHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `deletedAt` DATETIME(3) NULL,
  UNIQUE INDEX `desktop_sidebar_assets_storage_key` (`storageKey`),
  INDEX `desktop_sidebar_assets_user_deleted_created_idx` (`userId`, `deletedAt`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `desktop_sidebar_assets_size_chk` CHECK (`sizeBytes` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `desktop_templates` (
  `id` VARCHAR(36) NOT NULL,
  `publisherId` VARCHAR(191) NOT NULL,
  `slug` VARCHAR(160) NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `description` TEXT NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `pricingMode` VARCHAR(32) NOT NULL DEFAULT 'free',
  `priceMicros` BIGINT NULL,
  `currency` CHAR(3) NULL,
  `activeVersionId` VARCHAR(36) NULL,
  `createdByUserId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `desktop_templates_publisher_slug_key` (`publisherId`, `slug`),
  INDEX `desktop_templates_status_updated_idx` (`status`, `updatedAt`),
  INDEX `desktop_templates_publisher_status_updated_idx` (`publisherId`, `status`, `updatedAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `desktop_templates_pricing_mode_chk`
    CHECK (`pricingMode` IN ('free', 'paid')),
  CONSTRAINT `desktop_templates_price_chk`
    CHECK ((`pricingMode` = 'free' AND (`priceMicros` IS NULL OR `priceMicros` = 0)) OR
           (`pricingMode` = 'paid' AND `priceMicros` IS NOT NULL AND `priceMicros` >= 0))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `desktop_template_versions` (
  `id` VARCHAR(36) NOT NULL,
  `templateId` VARCHAR(36) NOT NULL,
  `version` VARCHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `manifest` JSON NOT NULL,
  `dataSchemaVersion` INTEGER NOT NULL DEFAULT 1,
  `storageKey` VARCHAR(512) NOT NULL,
  `originalFileName` VARCHAR(255) NOT NULL,
  `mimeType` VARCHAR(128) NOT NULL,
  `sizeBytes` BIGINT NOT NULL,
  `sha256` CHAR(64) NOT NULL,
  `createdByUserId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `publishedAt` DATETIME(3) NULL,
  UNIQUE INDEX `desktop_template_versions_storage_key` (`storageKey`),
  UNIQUE INDEX `desktop_template_versions_template_version_key` (`templateId`, `version`),
  INDEX `desktop_template_versions_template_status_created_idx` (`templateId`, `status`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `desktop_template_versions_size_chk` CHECK (`sizeBytes` >= 0),
  CONSTRAINT `desktop_template_versions_schema_version_chk` CHECK (`dataSchemaVersion` >= 1)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `desktop_template_screenshots` (
  `id` VARCHAR(36) NOT NULL,
  `templateVersionId` VARCHAR(36) NOT NULL,
  `sortOrder` INTEGER NOT NULL,
  `storageKey` VARCHAR(512) NOT NULL,
  `mimeType` VARCHAR(128) NOT NULL,
  `sizeBytes` BIGINT NOT NULL,
  `sha256` CHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `desktop_template_screenshots_storage_key` (`storageKey`),
  UNIQUE INDEX `desktop_template_screenshots_version_order_key` (`templateVersionId`, `sortOrder`),
  INDEX `desktop_template_screenshots_version_idx` (`templateVersionId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `desktop_template_screenshots_size_chk` CHECK (`sizeBytes` >= 0),
  CONSTRAINT `desktop_template_screenshots_order_chk` CHECK (`sortOrder` BETWEEN 0 AND 3)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `desktop_template_entitlements` (
  `id` VARCHAR(36) NOT NULL,
  `templateId` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `source` VARCHAR(32) NOT NULL,
  `reference` VARCHAR(191) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `grantedByUserId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `revokedAt` DATETIME(3) NULL,
  UNIQUE INDEX `desktop_template_entitlements_template_user_key` (`templateId`, `userId`),
  INDEX `desktop_template_entitlements_user_status_updated_idx` (`userId`, `status`, `updatedAt`),
  INDEX `desktop_template_entitlements_template_status_idx` (`templateId`, `status`),
  PRIMARY KEY (`id`),
  CONSTRAINT `desktop_template_entitlements_source_chk`
    CHECK (`source` IN ('free', 'admin_grant', 'purchase', 'migration')),
  CONSTRAINT `desktop_template_entitlements_status_chk`
    CHECK (`status` IN ('active', 'revoked'))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `desktop_template_audit_events` (
  `id` VARCHAR(36) NOT NULL,
  `actorUserId` VARCHAR(191) NOT NULL,
  `action` VARCHAR(128) NOT NULL,
  `targetType` VARCHAR(64) NOT NULL,
  `targetId` VARCHAR(191) NOT NULL,
  `requestId` VARCHAR(128) NOT NULL,
  `outcome` VARCHAR(32) NOT NULL DEFAULT 'success',
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `desktop_template_audit_target_created_idx` (`targetType`, `targetId`, `createdAt`),
  INDEX `desktop_template_audit_actor_created_idx` (`actorUserId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Conflict guard and backfill: this single INSERT is atomic. If an Agent has
-- more than one controlling employment, the profile primary key rejects the
-- statement and the migration stops without partially assigning controllers.
INSERT INTO `ai_direct_agent_appearance_profiles` (
  `agentId`,
  `avatarAssetId`,
  `defaultMode`,
  `controllerEmploymentId`,
  `controllerCompanyId`,
  `revision`,
  `updatedByUserId`,
  `createdAt`,
  `updatedAt`
)
SELECT
  employment.`agentId`,
  NULL,
  'image_2d',
  employment.`id`,
  employment.`companyId`,
  1,
  agent.`ownerUserId`,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `ai_direct_employments` AS employment
INNER JOIN `ai_direct_agents` AS agent ON agent.`id` = employment.`agentId`
WHERE employment.`status` IN ('accepted', 'onboarding', 'active', 'paused', 'offboarding');