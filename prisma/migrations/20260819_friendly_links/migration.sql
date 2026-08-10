-- Manage footer friendly links as operator-owned site configuration.

CREATE TABLE `friendly_links` (
  `id` VARCHAR(36) NOT NULL,
  `label` VARCHAR(80) NOT NULL,
  `url` VARCHAR(2048) NOT NULL,
  `description` VARCHAR(240) NULL,
  `sortOrder` INTEGER UNSIGNED NOT NULL DEFAULT 100,
  `isActive` BOOLEAN NOT NULL DEFAULT TRUE,
  `createdByUserId` VARCHAR(191) NULL,
  `updatedByUserId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `friendly_links_active_sort_idx` (`isActive`, `sortOrder`, `id`),
  INDEX `friendly_links_sort_idx` (`sortOrder`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `friendly_links`
  (`id`, `label`, `url`, `description`, `sortOrder`, `isActive`)
VALUES
  ('seed-ai-direct-desktop', 'AI直聘桌面端', 'https://github.com/yungou168-source/iclawstore', 'AI 直聘桌面端项目', 10, TRUE),
  ('seed-agency-agents-zh', 'agency-agents-zh', 'https://github.com/jnMetaCode/agency-agents-zh', '中文 AI Agent 资源', 20, TRUE);