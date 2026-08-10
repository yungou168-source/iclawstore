-- Unify free and paid Agent hiring under one immutable sale fact.

CREATE TABLE `ai_direct_agent_sales` (
  `id` VARCHAR(36) NOT NULL,
  `saleNo` VARCHAR(64) NOT NULL,
  `hiringIntentId` VARCHAR(36) NOT NULL,
  `employmentId` VARCHAR(36) NOT NULL,
  `offerId` VARCHAR(36) NOT NULL,
  `paymentOrderId` VARCHAR(36) NULL,
  `organizationId` VARCHAR(36) NOT NULL,
  `companyId` VARCHAR(36) NOT NULL,
  `projectId` VARCHAR(36) NULL,
  `roleId` VARCHAR(36) NOT NULL,
  `positionId` VARCHAR(36) NOT NULL,
  `buyerUserId` VARCHAR(191) NOT NULL,
  `developerUserId` VARCHAR(191) NOT NULL,
  `agentId` VARCHAR(36) NOT NULL,
  `agentVersionId` VARCHAR(36) NOT NULL,
  `priceId` VARCHAR(36) NOT NULL,
  `priceVersion` INTEGER NOT NULL,
  `pricingMode` VARCHAR(16) NOT NULL,
  `currency` CHAR(3) NOT NULL DEFAULT 'CNY',
  `grossAmountFen` BIGINT UNSIGNED NOT NULL,
  `platformRevenueFen` BIGINT UNSIGNED NOT NULL,
  `developerRevenueFen` BIGINT UNSIGNED NOT NULL,
  `refundedFen` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'completed',
  `completedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_direct_agent_sales_sale_no_key` (`saleNo`),
  UNIQUE INDEX `ai_direct_agent_sales_intent_key` (`hiringIntentId`),
  UNIQUE INDEX `ai_direct_agent_sales_employment_key` (`employmentId`),
  UNIQUE INDEX `ai_direct_agent_sales_offer_key` (`offerId`),
  UNIQUE INDEX `ai_direct_agent_sales_payment_order_key` (`paymentOrderId`),
  INDEX `ai_direct_agent_sales_developer_created_idx` (`developerUserId`, `createdAt`, `id`),
  INDEX `ai_direct_agent_sales_buyer_created_idx` (`buyerUserId`, `createdAt`, `id`),
  INDEX `ai_direct_agent_sales_agent_created_idx` (`agentId`, `createdAt`, `id`),
  INDEX `ai_direct_agent_sales_company_created_idx` (`companyId`, `createdAt`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_direct_revenue_ledger_entries`
  ADD COLUMN `saleId` VARCHAR(36) NULL AFTER `entryKey`,
  MODIFY COLUMN `paymentOrderId` VARCHAR(36) NULL,
  ADD INDEX `ai_direct_revenue_ledger_sale_idx` (`saleId`, `createdAt`);

INSERT INTO `ai_direct_agent_sales`
  (`id`, `saleNo`, `hiringIntentId`, `employmentId`, `offerId`, `paymentOrderId`,
   `organizationId`, `companyId`, `projectId`, `roleId`, `positionId`, `buyerUserId`,
   `developerUserId`, `agentId`, `agentVersionId`, `priceId`, `priceVersion`,
   `pricingMode`, `currency`, `grossAmountFen`, `platformRevenueFen`,
   `developerRevenueFen`, `refundedFen`, `status`, `completedAt`, `createdAt`)
SELECT UUID(), CONCAT('SALE-', SUBSTRING(SHA2(po.id, 256), 1, 32)), hi.id, po.employmentId, po.offerId, po.id,
       hi.organizationId, hi.companyId, hi.projectId, hi.roleId, hi.positionId,
       hi.requestedByUserId, po.developerUserId, hi.agentId, hi.agentVersionId,
       po.priceId, po.priceVersion, 'paid', po.currency, po.grossAmountFen,
       po.platformFeeFen, po.developerPayableFen, po.refundedFen, 'completed',
       COALESCE(po.fulfilledAt, po.updatedAt), COALESCE(po.fulfilledAt, po.createdAt)
FROM `ai_direct_payment_orders` po
JOIN `ai_direct_hiring_intents` hi ON hi.id = po.hiringIntentId
WHERE po.status = 'fulfilled' AND po.offerId IS NOT NULL AND po.employmentId IS NOT NULL;

UPDATE `ai_direct_revenue_ledger_entries` ledger
JOIN `ai_direct_agent_sales` sale ON sale.paymentOrderId = ledger.paymentOrderId
SET ledger.saleId = sale.id;

ALTER TABLE `ai_direct_revenue_ledger_entries`
  MODIFY COLUMN `saleId` VARCHAR(36) NOT NULL;