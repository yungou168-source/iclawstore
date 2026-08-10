-- User wallet: cached balances backed by an immutable ledger, Alipay recharge orders,
-- wallet refunds, and user-requested developer earnings withdrawals.

CREATE TABLE `wallet_accounts` (
  `id` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `currency` CHAR(3) NOT NULL DEFAULT 'CNY',
  `availableFen` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `frozenFen` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `version` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `wallet_accounts_user_currency_key` (`userId`, `currency`),
  INDEX `wallet_accounts_updated_idx` (`updatedAt`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `wallet_ledger_entries` (
  `id` VARCHAR(36) NOT NULL,
  `entryKey` VARCHAR(191) NOT NULL,
  `walletAccountId` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `currency` CHAR(3) NOT NULL DEFAULT 'CNY',
  `entryType` VARCHAR(32) NOT NULL,
  `businessType` VARCHAR(32) NOT NULL,
  `businessId` VARCHAR(64) NOT NULL,
  `availableDeltaFen` BIGINT NOT NULL DEFAULT 0,
  `frozenDeltaFen` BIGINT NOT NULL DEFAULT 0,
  `availableAfterFen` BIGINT UNSIGNED NOT NULL,
  `frozenAfterFen` BIGINT UNSIGNED NOT NULL,
  `actorUserId` VARCHAR(191) NULL,
  `reason` VARCHAR(512) NULL,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `wallet_ledger_entry_key` (`entryKey`),
  INDEX `wallet_ledger_user_created_idx` (`userId`, `createdAt`, `id`),
  INDEX `wallet_ledger_business_idx` (`businessType`, `businessId`, `createdAt`),
  CONSTRAINT `wallet_ledger_account_fk` FOREIGN KEY (`walletAccountId`) REFERENCES `wallet_accounts` (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `wallet_recharge_orders` (
  `id` VARCHAR(36) NOT NULL,
  `outTradeNo` VARCHAR(64) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(32) NOT NULL DEFAULT 'alipay',
  `currency` CHAR(3) NOT NULL DEFAULT 'CNY',
  `amountFen` BIGINT UNSIGNED NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `idempotencyKey` VARCHAR(128) NOT NULL,
  `idempotencyFingerprint` CHAR(64) NOT NULL,
  `providerTradeNo` VARCHAR(128) NULL,
  `rawNotifySha256` CHAR(64) NULL,
  `walletLedgerEntryId` VARCHAR(36) NULL,
  `paidAt` DATETIME(3) NULL,
  `closedAt` DATETIME(3) NULL,
  `lastReconciledAt` DATETIME(3) NULL,
  `lastProviderStatus` VARCHAR(64) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `wallet_recharge_out_trade_no_key` (`outTradeNo`),
  UNIQUE INDEX `wallet_recharge_user_idempotency_key` (`userId`, `idempotencyKey`),
  UNIQUE INDEX `wallet_recharge_provider_trade_key` (`provider`, `providerTradeNo`),
  UNIQUE INDEX `wallet_recharge_ledger_key` (`walletLedgerEntryId`),
  INDEX `wallet_recharge_user_created_idx` (`userId`, `createdAt`, `id`),
  INDEX `wallet_recharge_status_updated_idx` (`status`, `updatedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `wallet_refund_orders` (
  `id` VARCHAR(36) NOT NULL,
  `paymentOrderId` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `currency` CHAR(3) NOT NULL DEFAULT 'CNY',
  `amountFen` BIGINT UNSIGNED NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `reason` VARCHAR(512) NOT NULL,
  `requestedByUserId` VARCHAR(191) NOT NULL,
  `reviewedByUserId` VARCHAR(191) NULL,
  `reviewNote` VARCHAR(512) NULL,
  `walletLedgerEntryId` VARCHAR(36) NULL,
  `completedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `wallet_refund_ledger_key` (`walletLedgerEntryId`),
  INDEX `wallet_refund_payment_status_idx` (`paymentOrderId`, `status`, `createdAt`),
  INDEX `wallet_refund_user_created_idx` (`userId`, `createdAt`, `id`),
  INDEX `wallet_refund_status_created_idx` (`status`, `createdAt`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_direct_payment_orders`
  ADD COLUMN `payerUserId` VARCHAR(191) NULL,
  ADD COLUMN `walletLedgerEntryId` VARCHAR(36) NULL,
  ADD COLUMN `refundedFen` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD UNIQUE INDEX `ai_direct_payment_orders_wallet_ledger_key` (`walletLedgerEntryId`),
  ADD INDEX `ai_direct_payment_orders_payer_status_idx` (`payerUserId`, `status`, `updatedAt`);

ALTER TABLE `ai_direct_developer_settlements`
  ADD COLUMN `requestedByUserId` VARCHAR(191) NULL,
  ADD COLUMN `reviewedByUserId` VARCHAR(191) NULL,
  ADD COLUMN `reviewedAt` DATETIME(3) NULL,
  ADD COLUMN `reviewNote` VARCHAR(512) NULL,
  ADD INDEX `ai_direct_developer_settlements_requester_status_idx` (`requestedByUserId`, `status`, `createdAt`);