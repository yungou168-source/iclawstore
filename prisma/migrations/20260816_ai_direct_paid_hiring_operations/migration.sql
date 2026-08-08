-- Operational paid-hiring closure: query reconciliation state and manual settlement controls.
-- Additive only: prior payment, Offer, Employment, and ledger facts are immutable.

ALTER TABLE `ai_direct_payment_orders`
  ADD COLUMN `reconcileAttemptCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `lastReconciledAt` DATETIME(3) NULL,
  ADD COLUMN `nextReconcileAt` DATETIME(3) NULL,
  ADD COLUMN `lastProviderStatus` VARCHAR(64) NULL,
  ADD COLUMN `lastReconcileErrorCode` VARCHAR(128) NULL,
  ADD COLUMN `reconcileLeaseOwner` VARCHAR(128) NULL,
  ADD COLUMN `reconcileLeaseExpiresAt` DATETIME(3) NULL,
  ADD INDEX `ai_direct_payment_orders_reconcile_queue_idx` (`status`, `nextReconcileAt`, `reconcileLeaseExpiresAt`);

ALTER TABLE `ai_direct_developer_settlements`
  ADD COLUMN `failureReason` VARCHAR(512) NULL,
  ADD COLUMN `processingByUserId` VARCHAR(191) NULL,
  ADD COLUMN `processingAt` DATETIME(3) NULL,
  ADD INDEX `ai_direct_developer_settlements_status_created_idx` (`status`, `createdAt`);

CREATE TABLE `ai_direct_paid_hiring_operational_alerts` (
  `id` VARCHAR(36) NOT NULL,
  `paymentOrderId` VARCHAR(36) NOT NULL,
  `code` VARCHAR(128) NOT NULL,
  `severity` VARCHAR(16) NOT NULL DEFAULT 'warning',
  `status` VARCHAR(16) NOT NULL DEFAULT 'open',
  `occurrenceCount` INTEGER NOT NULL DEFAULT 1,
  `firstObservedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastObservedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `resolvedAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_direct_paid_hiring_alert_order_code_key` (`paymentOrderId`, `code`),
  INDEX `ai_direct_paid_hiring_alert_status_time_idx` (`status`, `lastObservedAt`));