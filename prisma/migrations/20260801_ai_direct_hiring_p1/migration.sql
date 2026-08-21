-- AI Direct Hiring P1: Companies, Projects, Roles, Capabilities, Offers, Employments, Approvals, WorkflowRuns
-- Extends P0 foundation (ai_direct_organizations, ai_direct_organization_members, ai_direct_audit_events, ai_direct_outbox_events).
-- All tables use IF NOT EXISTS so this is safe to apply after P0.

CREATE TABLE IF NOT EXISTS `ai_direct_companies` (
  `id` VARCHAR(36) NOT NULL,
  `organizationId` VARCHAR(36) NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `slug` VARCHAR(160) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `createdByUserId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_direct_companies_slug_key`(`slug`),
  INDEX `ai_direct_companies_organizationId_status_idx`(`organizationId`, `status`),
  INDEX `ai_direct_companies_organizationId_updatedAt_idx`(`organizationId`, `updatedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_direct_projects` (
  `id` VARCHAR(36) NOT NULL,
  `companyId` VARCHAR(36) NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `slug` VARCHAR(160) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `budgetMicros` BIGINT NULL DEFAULT 0,
  `sensitivityLimit` VARCHAR(64) NULL,
  `createdByUserId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_direct_projects_companyId_slug_key`(`companyId`, `slug`),
  INDEX `ai_direct_projects_companyId_status_updatedAt_idx`(`companyId`, `status`, `updatedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_direct_agent_roles` (
  `id` VARCHAR(36) NOT NULL,
  `companyId` VARCHAR(36) NOT NULL,
  `projectId` VARCHAR(36) NULL,
  `name` VARCHAR(160) NOT NULL,
  `responsibilities` JSON NOT NULL,
  `requiredCapabilities` JSON NOT NULL,
  `budgetMicros` BIGINT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'open',
  `createdByUserId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX `ai_direct_agent_roles_companyId_status_updatedAt_idx`(`companyId`, `status`, `updatedAt`),
  INDEX `ai_direct_agent_roles_projectId_status_idx`(`projectId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_direct_capability_grants` (
  `id` VARCHAR(36) NOT NULL,
  `subjectType` VARCHAR(32) NOT NULL,
  `subjectId` VARCHAR(191) NOT NULL,
  `resourceType` VARCHAR(64) NOT NULL,
  `resourceId` VARCHAR(191) NOT NULL,
  `action` VARCHAR(64) NOT NULL,
  `scope` JSON NULL,
  `issuedByUserId` VARCHAR(191) NOT NULL,
  `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expiresAt` DATETIME(3) NULL,
  `revokedAt` DATETIME(3) NULL,
  `revokedByUserId` VARCHAR(191) NULL,
  `revokeReason` TEXT NULL,
  INDEX `ai_direct_capability_grants_subject_idx`(`subjectType`, `subjectId`, `resourceType`, `resourceId`, `revokedAt`),
  INDEX `ai_direct_capability_grants_resource_idx`(`resourceType`, `resourceId`, `revokedAt`),
  INDEX `ai_direct_capability_grants_revokedAt_idx`(`revokedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_direct_offers` (
  `id` VARCHAR(36) NOT NULL,
  `roleId` VARCHAR(36) NOT NULL,
  `agentVersionId` VARCHAR(36) NOT NULL,
  `companyId` VARCHAR(36) NOT NULL,
  `projectId` VARCHAR(36) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `terms` JSON NOT NULL,
  `approvalId` VARCHAR(36) NULL,
  `proposedByUserId` VARCHAR(191) NOT NULL,
  `proposedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expiresAt` DATETIME(3) NULL,
  `acceptedAt` DATETIME(3) NULL,
  `rejectedAt` DATETIME(3) NULL,
  `rejectedReason` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_direct_offers_roleId_agentVersionId_status_key`(`roleId`, `agentVersionId`, `status`),
  INDEX `ai_direct_offers_companyId_status_updatedAt_idx`(`companyId`, `status`, `updatedAt`),
  INDEX `ai_direct_offers_agentVersionId_idx`(`agentVersionId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_direct_employments` (
  `id` VARCHAR(36) NOT NULL,
  `companyId` VARCHAR(36) NOT NULL,
  `agentId` VARCHAR(36) NOT NULL,
  `agentVersionId` VARCHAR(36) NOT NULL,
  `roleId` VARCHAR(36) NOT NULL,
  `projectId` VARCHAR(36) NULL,
  `offerId` VARCHAR(36) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'candidate',
  `startedAt` DATETIME(3) NULL,
  `endedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX `ai_direct_employments_companyId_status_updatedAt_idx`(`companyId`, `status`, `updatedAt`),
  INDEX `ai_direct_employments_agentId_status_idx`(`agentId`, `status`),
  INDEX `ai_direct_employments_agentVersionId_idx`(`agentVersionId`),
  INDEX `ai_direct_employments_roleId_idx`(`roleId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_direct_employment_events` (
  `id` VARCHAR(36) NOT NULL,
  `employmentId` VARCHAR(36) NOT NULL,
  `sequence` INTEGER NOT NULL,
  `fromStatus` VARCHAR(32) NULL,
  `toStatus` VARCHAR(32) NOT NULL,
  `actorUserId` VARCHAR(191) NOT NULL,
  `reason` TEXT NULL,
  `approvalId` VARCHAR(36) NULL,
  `metadata` JSON NULL,
  `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_direct_employment_events_employmentId_sequence_key`(`employmentId`, `sequence`),
  INDEX `ai_direct_employment_events_employmentId_occurredAt_idx`(`employmentId`, `occurredAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_direct_approvals` (
  `id` VARCHAR(36) NOT NULL,
  `organizationId` VARCHAR(36) NULL,
  `targetType` VARCHAR(64) NOT NULL,
  `targetId` VARCHAR(191) NOT NULL,
  `requestedByUserId` VARCHAR(191) NOT NULL,
  `approverUserId` VARCHAR(191) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `decision` VARCHAR(32) NULL,
  `decisionReason` TEXT NULL,
  `expiresAt` DATETIME(3) NULL,
  `decidedAt` DATETIME(3) NULL,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX `ai_direct_approvals_organizationId_status_updatedAt_idx`(`organizationId`, `status`, `updatedAt`),
  INDEX `ai_direct_approvals_targetType_targetId_status_idx`(`targetType`, `targetId`, `status`),
  INDEX `ai_direct_approvals_approverUserId_status_updatedAt_idx`(`approverUserId`, `status`, `updatedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_direct_workflow_runs` (
  `id` VARCHAR(36) NOT NULL,
  `organizationId` VARCHAR(36) NULL,
  `employmentId` VARCHAR(36) NULL,
  `agentVersionId` VARCHAR(36) NULL,
  `workflowKey` VARCHAR(128) NOT NULL,
  `workflowVersion` VARCHAR(64) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'queued',
  `requestedByUserId` VARCHAR(191) NOT NULL,
  `approvalId` VARCHAR(36) NULL,
  `requestedModelPolicy` JSON NULL,
  `resolvedModelCatalogId` VARCHAR(36) NULL,
  `resolvedModelKey` VARCHAR(255) NULL,
  `modelRunAuditIds` JSON NULL,
  `inputSummary` JSON NULL,
  `outputIndex` JSON NULL,
  `tokenUsage` JSON NULL,
  `costMicros` BIGINT NULL,
  `latencyMs` INTEGER NULL,
  `failureCode` VARCHAR(128) NULL,
  `failureReason` TEXT NULL,
  `metadata` JSON NULL,
  `startedAt` DATETIME(3) NULL,
  `finishedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX `ai_direct_workflow_runs_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
  INDEX `ai_direct_workflow_runs_employmentId_createdAt_idx`(`employmentId`, `createdAt`),
  INDEX `ai_direct_workflow_runs_status_updatedAt_idx`(`status`, `updatedAt`),
  INDEX `ai_direct_workflow_runs_requestedByUserId_status_updatedAt_idx`(`requestedByUserId`, `status`, `updatedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_direct_workflow_run_steps` (
  `id` VARCHAR(36) NOT NULL,
  `runId` VARCHAR(36) NOT NULL,
  `stepKey` VARCHAR(128) NOT NULL,
  `sequence` INTEGER NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `catalogModelId` VARCHAR(36) NULL,
  `modelKey` VARCHAR(255) NULL,
  `inputTokens` INTEGER NULL,
  `outputTokens` INTEGER NULL,
  `costMicros` BIGINT NULL,
  `latencyMs` INTEGER NULL,
  `failureCode` VARCHAR(128) NULL,
  `startedAt` DATETIME(3) NULL,
  `finishedAt` DATETIME(3) NULL,
  `outputSummary` JSON NULL,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_direct_workflow_run_steps_runId_sequence_key`(`runId`, `sequence`),
  INDEX `ai_direct_workflow_run_steps_runId_sequence_idx`(`runId`, `sequence`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
