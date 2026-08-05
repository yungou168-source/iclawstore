CREATE TABLE `ai_direct_interview_retention_policies` (
  `organizationId` VARCHAR(36) NOT NULL,
  `bodyRetentionDays` INT NOT NULL DEFAULT 90,
  `modelConsentMode` VARCHAR(64) NOT NULL DEFAULT 'organization_default_opt_in',
  `attachmentPolicy` VARCHAR(64) NOT NULL DEFAULT 'image_pdf_only',
  `attachmentMaxBytes` INT NOT NULL DEFAULT 10485760,
  `version` INT NOT NULL DEFAULT 1,
  `updatedByUserId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`organizationId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_direct_interview_conversations` (
  `id` VARCHAR(36) NOT NULL,
  `organizationId` VARCHAR(36) NOT NULL,
  `agentVersionId` VARCHAR(36) NOT NULL,
  `createdByUserId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `latestSequence` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `interview_conversations_org_status_updated_idx` (`organizationId`, `status`, `updatedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_direct_interview_participants` (
  `id` VARCHAR(36) NOT NULL,
  `conversationId` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `modelUseOptedOutAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `interview_participants_conversation_user_key` (`conversationId`, `userId`),
  INDEX `interview_participants_user_status_updated_idx` (`userId`, `status`, `updatedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_direct_interview_messages` (
  `id` VARCHAR(36) NOT NULL,
  `conversationId` VARCHAR(36) NOT NULL,
  `sequence` INT NOT NULL,
  `senderUserId` VARCHAR(191) NOT NULL,
  `body` TEXT NOT NULL,
  `retentionExpiresAt` DATETIME(3) NOT NULL,
  `deletedAt` DATETIME(3) NULL,
  `deletedByUserId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `interview_messages_conversation_sequence_key` (`conversationId`, `sequence`),
  INDEX `interview_messages_retention_deleted_idx` (`retentionExpiresAt`, `deletedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_direct_interview_read_cursors` (
  `conversationId` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `sequence` INT NOT NULL DEFAULT 0,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`conversationId`, `userId`),
  INDEX `interview_read_cursors_user_updated_idx` (`userId`, `updatedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_direct_interview_legal_holds` (
  `id` VARCHAR(36) NOT NULL,
  `organizationId` VARCHAR(36) NOT NULL,
  `conversationId` VARCHAR(36) NULL,
  `messageId` VARCHAR(36) NULL,
  `reason` VARCHAR(500) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `createdByUserId` VARCHAR(191) NOT NULL,
  `releasedByUserId` VARCHAR(191) NULL,
  `releasedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `interview_legal_holds_org_status_idx` (`organizationId`, `status`),
  INDEX `interview_legal_holds_conversation_status_idx` (`conversationId`, `status`),
  INDEX `interview_legal_holds_message_status_idx` (`messageId`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_direct_interview_attachments` (
  `id` VARCHAR(36) NOT NULL,
  `messageId` VARCHAR(36) NOT NULL,
  `storageKey` VARCHAR(512) NOT NULL,
  `mimeType` VARCHAR(128) NOT NULL,
  `sizeBytes` BIGINT NOT NULL,
  `sha256` CHAR(64) NOT NULL,
  `retentionExpiresAt` DATETIME(3) NOT NULL,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `interview_attachments_storage_key` (`storageKey`),
  INDEX `interview_attachments_message_idx` (`messageId`),
  INDEX `interview_attachments_retention_deleted_idx` (`retentionExpiresAt`, `deletedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;