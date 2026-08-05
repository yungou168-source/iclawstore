-- Central audit governance is intentionally additive. Prisma models must be
-- added separately before application code may use generated delegates.

ALTER TABLE `desktop_template_audit_events`
  ADD COLUMN `organizationId` VARCHAR(36) NULL AFTER `id`;

CREATE INDEX `ai_direct_audit_org_time_cursor_idx`
  ON `ai_direct_audit_events` (`organizationId`, `createdAt`, `id`);
CREATE INDEX `ai_direct_audit_org_actor_time_cursor_idx`
  ON `ai_direct_audit_events` (`organizationId`, `actorUserId`, `createdAt`, `id`);
CREATE INDEX `ai_direct_audit_org_resource_time_cursor_idx`
  ON `ai_direct_audit_events` (`organizationId`, `targetType`, `targetId`, `createdAt`, `id`);
CREATE INDEX `ai_direct_audit_org_action_time_cursor_idx`
  ON `ai_direct_audit_events` (`organizationId`, `action`, `createdAt`, `id`);
CREATE INDEX `ai_direct_audit_org_request_time_cursor_idx`
  ON `ai_direct_audit_events` (`organizationId`, `requestId`, `createdAt`, `id`);

CREATE INDEX `ai_direct_model_audit_run_time_cursor_idx`
  ON `ai_direct_model_run_audits` (`runId`, `createdAt`, `id`);

CREATE INDEX `desktop_template_audit_org_time_cursor_idx`
  ON `desktop_template_audit_events` (`organizationId`, `createdAt`, `id`);
CREATE INDEX `desktop_template_audit_org_actor_time_cursor_idx`
  ON `desktop_template_audit_events` (`organizationId`, `actorUserId`, `createdAt`, `id`);
CREATE INDEX `desktop_template_audit_org_resource_time_cursor_idx`
  ON `desktop_template_audit_events` (`organizationId`, `targetType`, `targetId`, `createdAt`, `id`);
CREATE INDEX `desktop_template_audit_org_action_time_cursor_idx`
  ON `desktop_template_audit_events` (`organizationId`, `action`, `createdAt`, `id`);
CREATE INDEX `desktop_template_audit_org_request_time_cursor_idx`
  ON `desktop_template_audit_events` (`organizationId`, `requestId`, `createdAt`, `id`);

CREATE INDEX `ai_direct_capability_audit_permission_idx`
  ON `ai_direct_capability_grants`
  (`subjectType`, `subjectId`, `resourceType`, `resourceId`, `action`, `revokedAt`, `expiresAt`);

CREATE TABLE `ai_direct_audit_export_jobs` (
  `id` VARCHAR(36) NOT NULL,
  `organizationId` VARCHAR(36) NOT NULL,
  `requestedByUserId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'queued',
  `filters` JSON NOT NULL,
  `watermark` VARCHAR(512) NOT NULL,
  `requestId` VARCHAR(128) NULL,
  `attemptCount` INT NOT NULL DEFAULT 0,
  `leaseOwner` VARCHAR(128) NULL,
  `leaseExpiresAt` DATETIME(3) NULL,
  `artifact` LONGBLOB NULL,
  `artifactMimeType` VARCHAR(255) NULL,
  `artifactFileName` VARCHAR(255) NULL,
  `artifactSizeBytes` BIGINT UNSIGNED NULL,
  `artifactSha256` CHAR(64) NULL,
  `failureCode` VARCHAR(128) NULL,
  `startedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `ai_direct_audit_exports_org_created_idx` (`organizationId`, `createdAt`, `id`),
  INDEX `ai_direct_audit_exports_org_requester_created_idx` (`organizationId`, `requestedByUserId`, `createdAt`, `id`),
  INDEX `ai_direct_audit_exports_queue_idx` (`status`, `leaseExpiresAt`, `createdAt`, `id`),
  INDEX `ai_direct_audit_exports_request_idx` (`organizationId`, `requestId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_direct_audit_export_download_tokens` (
  `id` VARCHAR(36) NOT NULL,
  `exportJobId` VARCHAR(36) NOT NULL,
  `organizationId` VARCHAR(36) NOT NULL,
  `tokenPrefix` VARCHAR(12) NOT NULL,
  `tokenHash` CHAR(64) NOT NULL,
  `issuedToUserId` VARCHAR(191) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `usedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_direct_audit_download_token_hash_key` (`tokenHash`),
  INDEX `ai_direct_audit_download_job_expiry_idx` (`exportJobId`, `expiresAt`, `usedAt`),
  INDEX `ai_direct_audit_download_org_user_created_idx` (`organizationId`, `issuedToUserId`, `createdAt`),
  CONSTRAINT `ai_direct_audit_download_job_fk`
    FOREIGN KEY (`exportJobId`) REFERENCES `ai_direct_audit_export_jobs` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;