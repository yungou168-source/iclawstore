-- Stable bridge from a verified Convex Auth identity to the MySQL business user.
-- Provider accounts remain owned by Convex Auth; this table never stores OAuth tokens.
CREATE TABLE IF NOT EXISTS `ai_direct_auth_identities` (
  `id` VARCHAR(36) NOT NULL,
  `issuer` VARCHAR(255) NOT NULL,
  `subject` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `lastAuthenticatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_direct_auth_identities_issuer_subject_key`(`issuer`, `subject`),
  UNIQUE INDEX `ai_direct_auth_identities_userId_key`(`userId`),
  INDEX `ai_direct_auth_identities_lastAuthenticatedAt_idx`(`lastAuthenticatedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;