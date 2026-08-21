ALTER TABLE `convex_exit_managed_assets`
  ADD COLUMN `scannerStatus` VARCHAR(32) NOT NULL DEFAULT 'clean',
  ADD COLUMN `createdByUserId` VARCHAR(191) NULL,
  ADD COLUMN `targetId` VARCHAR(191) NULL;

CREATE TABLE `managed_asset_upload_tickets` (
  `id` VARCHAR(36) NOT NULL,
  `tokenHash` CHAR(64) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `assetKind` VARCHAR(64) NOT NULL,
  `targetId` VARCHAR(191) NOT NULL,
  `maxBytes` BIGINT NOT NULL,
  `allowedMimeTypes` JSON NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `consumedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `managed_asset_upload_tickets_token_hash_key`(`tokenHash`),
  INDEX `managed_asset_upload_tickets_user_state_idx`(`userId`, `expiresAt`, `consumedAt`),
  INDEX `managed_asset_upload_tickets_target_kind_idx`(`targetId`, `assetKind`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;