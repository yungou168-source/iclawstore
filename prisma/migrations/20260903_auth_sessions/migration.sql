-- Independent JWT session state for immediate revocation.
CREATE TABLE `auth_sessions` (
  `id` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `issuer` VARCHAR(255) NOT NULL,
  `tokenId` VARCHAR(191) NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `revokedAt` DATETIME(3) NULL,
  `lastAuthenticatedAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `auth_sessions_issuer_token_id_key` (`issuer`, `tokenId`),
  KEY `auth_sessions_user_status_idx` (`userId`, `revokedAt`, `expiresAt`),
  CONSTRAINT `auth_sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;