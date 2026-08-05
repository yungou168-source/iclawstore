-- Additive desktop template review/publication split.
-- The legacy status columns remain for compatibility until Prisma and all consumers migrate.

ALTER TABLE `desktop_templates`
  ADD COLUMN `catalogStatus` VARCHAR(32) NOT NULL DEFAULT 'unpublished' AFTER `status`;

UPDATE `desktop_templates`
SET `catalogStatus` = CASE WHEN `status` = 'published' THEN 'published' ELSE 'unpublished' END;

ALTER TABLE `desktop_templates`
  ADD INDEX `desktop_templates_catalog_updated_idx` (`catalogStatus`, `updatedAt`),
  ADD INDEX `desktop_templates_publisher_catalog_updated_idx` (`publisherId`, `catalogStatus`, `updatedAt`);

ALTER TABLE `desktop_template_versions`
  ADD COLUMN `reviewStatus` VARCHAR(32) NOT NULL DEFAULT 'draft' AFTER `status`,
  ADD COLUMN `publicationStatus` VARCHAR(32) NOT NULL DEFAULT 'unpublished' AFTER `reviewStatus`,
  ADD COLUMN `reviewDecisionId` VARCHAR(36) NULL AFTER `publicationStatus`,
  ADD COLUMN `submittedAt` DATETIME(3) NULL AFTER `reviewDecisionId`,
  ADD COLUMN `reviewedAt` DATETIME(3) NULL AFTER `submittedAt`;

UPDATE `desktop_template_versions`
SET
  `reviewStatus` = CASE
    WHEN `status` = 'pending_review' THEN 'pending_review'
    WHEN `status` = 'published' THEN 'approved'
    ELSE 'draft'
  END,
  `publicationStatus` = CASE WHEN `status` = 'published' THEN 'published' ELSE 'unpublished' END,
  `submittedAt` = CASE WHEN `status` IN ('pending_review', 'published') THEN `createdAt` ELSE NULL END,
  `reviewedAt` = CASE WHEN `status` = 'published' THEN COALESCE(`publishedAt`, `createdAt`) ELSE NULL END;

ALTER TABLE `desktop_template_versions`
  ADD INDEX `desktop_template_versions_review_queue_idx` (`reviewStatus`, `submittedAt`, `id`),
  ADD INDEX `desktop_template_versions_template_publication_created_idx` (`templateId`, `publicationStatus`, `createdAt`),
  ADD INDEX `desktop_template_versions_decision_idx` (`reviewDecisionId`);

CREATE TABLE `desktop_template_review_decisions` (
  `id` VARCHAR(36) NOT NULL,
  `templateVersionId` VARCHAR(36) NOT NULL,
  `decision` VARCHAR(32) NOT NULL,
  `reason` TEXT NULL,
  `actorUserId` VARCHAR(191) NOT NULL,
  `requestId` VARCHAR(128) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `desktop_template_review_version_created_idx` (`templateVersionId`, `createdAt`, `id`),
  INDEX `desktop_template_review_actor_created_idx` (`actorUserId`, `createdAt`),
  CONSTRAINT `desktop_template_review_version_fk`
    FOREIGN KEY (`templateVersionId`) REFERENCES `desktop_template_versions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `desktop_template_review_decision_chk`
    CHECK (`decision` IN ('approved', 'rejected')),
  CONSTRAINT `desktop_template_review_reason_chk`
    CHECK (`decision` = 'approved' OR (`reason` IS NOT NULL AND CHAR_LENGTH(TRIM(`reason`)) > 0))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `desktop_template_versions`
  ADD CONSTRAINT `desktop_template_versions_review_decision_fk`
  FOREIGN KEY (`reviewDecisionId`) REFERENCES `desktop_template_review_decisions` (`id`) ON DELETE SET NULL;

CREATE TABLE `desktop_template_outbox` (
  `id` VARCHAR(36) NOT NULL,
  `topic` VARCHAR(128) NOT NULL,
  `aggregateType` VARCHAR(64) NOT NULL,
  `aggregateId` VARCHAR(191) NOT NULL,
  `payload` JSON NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `availableAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `publishedAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `desktop_template_outbox_dispatch_idx` (`status`, `availableAt`, `createdAt`),
  INDEX `desktop_template_outbox_aggregate_idx` (`aggregateType`, `aggregateId`, `createdAt`),
  CONSTRAINT `desktop_template_outbox_status_chk`
    CHECK (`status` IN ('pending', 'processing', 'published', 'failed')),
  CONSTRAINT `desktop_template_outbox_attempts_chk` CHECK (`attempts` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `desktop_template_download_events` (
  `id` VARCHAR(36) NOT NULL,
  `templateId` VARCHAR(36) NOT NULL,
  `templateVersionId` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `entitlementSource` VARCHAR(32) NOT NULL,
  `requestId` VARCHAR(128) NOT NULL,
  `downloadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `desktop_template_download_template_created_idx` (`templateId`, `downloadedAt`, `id`),
  INDEX `desktop_template_download_version_created_idx` (`templateVersionId`, `downloadedAt`, `id`),
  INDEX `desktop_template_download_user_created_idx` (`userId`, `downloadedAt`),
  CONSTRAINT `desktop_template_download_template_fk`
    FOREIGN KEY (`templateId`) REFERENCES `desktop_templates` (`id`) ON DELETE CASCADE,
  CONSTRAINT `desktop_template_download_version_fk`
    FOREIGN KEY (`templateVersionId`) REFERENCES `desktop_template_versions` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;