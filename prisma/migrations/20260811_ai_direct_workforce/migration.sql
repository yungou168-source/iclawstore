-- WorkforceModule: company-owned departments, position headcount, and AgentRole placement.
-- Existing Offer and Employment rows continue to reference ai_direct_agent_roles.roleId.

CREATE TABLE `ai_direct_departments` (
  `id` VARCHAR(36) NOT NULL,
  `companyId` VARCHAR(36) NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdByUserId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_direct_departments_companyId_name_key` (`companyId`, `name`),
  INDEX `ai_direct_departments_companyId_status_sortOrder_idx` (`companyId`, `status`, `sortOrder`, `id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_direct_positions` (
  `id` VARCHAR(36) NOT NULL,
  `departmentId` VARCHAR(36) NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `headcountTarget` INTEGER NOT NULL DEFAULT 1,
  `headcountFilled` INTEGER NOT NULL DEFAULT 0,
  `requirementsSummary` JSON NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdByUserId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_direct_positions_departmentId_name_key` (`departmentId`, `name`),
  INDEX `ai_direct_positions_departmentId_status_sortOrder_idx` (`departmentId`, `status`, `sortOrder`, `id`),
  INDEX `ai_direct_positions_status_updatedAt_idx` (`status`, `updatedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_direct_position_agent_roles` (
  `positionId` VARCHAR(36) NOT NULL,
  `roleId` VARCHAR(36) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`positionId`, `roleId`),
  UNIQUE INDEX `ai_direct_position_agent_roles_roleId_key` (`roleId`),
  INDEX `ai_direct_position_agent_roles_positionId_idx` (`positionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;