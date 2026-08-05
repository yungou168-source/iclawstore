CREATE TABLE `ai_direct_approval_events` (
  `id` VARCHAR(36) NOT NULL,
  `approvalId` VARCHAR(36) NOT NULL,
  `organizationId` VARCHAR(36) NULL,
  `sequence` INT NOT NULL,
  `eventType` VARCHAR(64) NOT NULL,
  `actorUserId` VARCHAR(191) NULL,
  `requestId` VARCHAR(128) NOT NULL,
  `metadata` JSON NULL,
  `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_direct_approval_events_approval_sequence_key` (`approvalId`, `sequence`),
  INDEX `ai_direct_approval_events_approval_occurred_idx` (`approvalId`, `occurredAt`, `id`),
  INDEX `ai_direct_approval_events_org_occurred_idx` (`organizationId`, `occurredAt`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_direct_approval_delegations` (
  `id` VARCHAR(36) NOT NULL,
  `approvalId` VARCHAR(36) NOT NULL,
  `organizationId` VARCHAR(36) NOT NULL,
  `fromUserId` VARCHAR(191) NULL,
  `toUserId` VARCHAR(191) NOT NULL,
  `delegatedByUserId` VARCHAR(191) NOT NULL,
  `reason` VARCHAR(500) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `ai_direct_approval_delegations_approval_created_idx` (`approvalId`, `createdAt`, `id`),
  INDEX `ai_direct_approval_delegations_org_to_created_idx` (`organizationId`, `toUserId`, `createdAt`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `ai_direct_approvals_pending_expiry_idx`
  ON `ai_direct_approvals` (`status`, `expiresAt`, `id`);