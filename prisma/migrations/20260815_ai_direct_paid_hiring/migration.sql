-- Paid hiring: developer pricing, Alipay orders, immutable 20/80 ledger, and manual settlements.
-- This migration is additive. Legacy Offer lifecycle columns remain for rollback and data migration,
-- but new paid hiring writes only issued Offer receipts.

CREATE TABLE `ai_direct_agent_prices` (
  `id` VARCHAR(36) NOT NULL,
  `agentId` VARCHAR(36) NOT NULL,
  `agentVersionId` VARCHAR(36) NOT NULL,
  `developerUserId` VARCHAR(191) NOT NULL,
  `version` INTEGER NOT NULL,
  `currency` CHAR(3) NOT NULL DEFAULT 'CNY',
  `amountFen` BIGINT UNSIGNED NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `createdByUserId` VARCHAR(191) NOT NULL,
  `effectiveAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `supersededAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_direct_agent_prices_agent_version_key`(`agentId`, `version`),
  INDEX `ai_direct_agent_prices_agent_status_version_idx`(`agentId`, `status`, `version`),
  INDEX `ai_direct_agent_prices_developer_status_idx`(`developerUserId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_direct_hiring_intents` (
  `id` VARCHAR(36) NOT NULL,
  `organizationId` VARCHAR(36) NOT NULL,
  `companyId` VARCHAR(36) NOT NULL,
  `projectId` VARCHAR(36) NULL,
  `roleId` VARCHAR(36) NOT NULL,
  `positionId` VARCHAR(36) NOT NULL,
  `agentId` VARCHAR(36) NOT NULL,
  `agentVersionId` VARCHAR(36) NOT NULL,
  `priceId` VARCHAR(36) NOT NULL,
  `requestedByUserId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'awaiting_payment',
  `approvalId` VARCHAR(36) NULL,
  `idempotencyKey` VARCHAR(128) NOT NULL,
  `idempotencyFingerprint` CHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_direct_hiring_intents_requester_idempotency_key`(`requestedByUserId`, `idempotencyKey`),
  INDEX `ai_direct_hiring_intents_company_status_created_idx`(`companyId`, `status`, `createdAt`),
  INDEX `ai_direct_hiring_intents_position_status_idx`(`positionId`, `status`),
  INDEX `ai_direct_hiring_intents_approval_idx`(`approvalId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_direct_payment_orders` (
  `id` VARCHAR(36) NOT NULL,
  `outTradeNo` VARCHAR(64) NOT NULL,
  `hiringIntentId` VARCHAR(36) NOT NULL,
  `provider` VARCHAR(32) NOT NULL DEFAULT 'alipay',
  `currency` CHAR(3) NOT NULL DEFAULT 'CNY',
  `grossAmountFen` BIGINT UNSIGNED NOT NULL,
  `platformFeeFen` BIGINT UNSIGNED NOT NULL,
  `developerPayableFen` BIGINT UNSIGNED NOT NULL,
  `developerUserId` VARCHAR(191) NOT NULL,
  `priceId` VARCHAR(36) NOT NULL,
  `priceVersion` INTEGER NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `providerTradeNo` VARCHAR(128) NULL,
  `rawNotifySha256` CHAR(64) NULL,
  `paidAt` DATETIME(3) NULL,
  `fulfilledAt` DATETIME(3) NULL,
  `offerId` VARCHAR(36) NULL,
  `employmentId` VARCHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_direct_payment_orders_out_trade_no_key`(`outTradeNo`),
  UNIQUE INDEX `ai_direct_payment_orders_hiring_intent_key`(`hiringIntentId`),
  UNIQUE INDEX `ai_direct_payment_orders_provider_trade_no_key`(`provider`, `providerTradeNo`),
  INDEX `ai_direct_payment_orders_status_updated_idx`(`status`, `updatedAt`),
  INDEX `ai_direct_payment_orders_developer_status_idx`(`developerUserId`, `status`, `updatedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_direct_revenue_ledger_entries` (
  `id` VARCHAR(36) NOT NULL,
  `entryKey` VARCHAR(191) NOT NULL,
  `paymentOrderId` VARCHAR(36) NOT NULL,
  `accountType` VARCHAR(32) NOT NULL,
  `accountOwnerUserId` VARCHAR(191) NULL,
  `direction` VARCHAR(16) NOT NULL DEFAULT 'credit',
  `currency` CHAR(3) NOT NULL DEFAULT 'CNY',
  `amountFen` BIGINT UNSIGNED NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'posted',
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_direct_revenue_ledger_entry_key`(`entryKey`),
  INDEX `ai_direct_revenue_ledger_order_idx`(`paymentOrderId`, `createdAt`),
  INDEX `ai_direct_revenue_ledger_owner_status_idx`(`accountOwnerUserId`, `accountType`, `status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_direct_developer_settlements` (
  `id` VARCHAR(36) NOT NULL,
  `developerUserId` VARCHAR(191) NOT NULL,
  `currency` CHAR(3) NOT NULL DEFAULT 'CNY',
  `amountFen` BIGINT UNSIGNED NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `externalReference` VARCHAR(191) NULL,
  `createdByUserId` VARCHAR(191) NOT NULL,
  `completedByUserId` VARCHAR(191) NULL,
  `completedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX `ai_direct_developer_settlements_developer_status_idx`(`developerUserId`, `status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_direct_developer_settlement_items` (
  `settlementId` VARCHAR(36) NOT NULL,
  `ledgerEntryId` VARCHAR(36) NOT NULL,
  `amountFen` BIGINT UNSIGNED NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_direct_settlement_items_ledger_key`(`ledgerEntryId`),
  INDEX `ai_direct_settlement_items_settlement_idx`(`settlementId`),
  PRIMARY KEY (`settlementId`, `ledgerEntryId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_direct_offers`
  ADD COLUMN `paymentOrderId` VARCHAR(36) NULL,
  ADD COLUMN `issuedAt` DATETIME(3) NULL,
  ADD UNIQUE INDEX `ai_direct_offers_payment_order_key`(`paymentOrderId`);

ALTER TABLE `ai_direct_employments`
  ADD COLUMN `paymentOrderId` VARCHAR(36) NULL,
  ADD UNIQUE INDEX `ai_direct_employments_payment_order_key`(`paymentOrderId`);