CREATE TABLE `desktop_profile_revisions` (
  `userId` VARCHAR(191) NOT NULL,
  `revision` BIGINT NOT NULL DEFAULT 0,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`userId`),
  CONSTRAINT `desktop_profile_revisions_user_fk`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `desktop_profile_assets` (
  `id` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `storageKey` VARCHAR(512) NOT NULL,
  `originalFileName` VARCHAR(255) NOT NULL,
  `mimeType` VARCHAR(128) NOT NULL,
  `sizeBytes` BIGINT NOT NULL,
  `sha256` CHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `deletedAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `desktop_profile_assets_user_active_idx` (`userId`, `deletedAt`),
  CONSTRAINT `desktop_profile_assets_user_fk`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;