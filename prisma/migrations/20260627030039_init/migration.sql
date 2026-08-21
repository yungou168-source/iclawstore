-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `image` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `emailVerificationTime` DATETIME(3) NULL,
    `phone` VARCHAR(191) NULL,
    `phoneVerificationTime` DATETIME(3) NULL,
    `isAnonymous` BOOLEAN NOT NULL DEFAULT false,
    `handle` VARCHAR(191) NULL,
    `displayName` VARCHAR(191) NULL,
    `bio` VARCHAR(191) NULL,
    `role` VARCHAR(191) NULL DEFAULT 'user',
    `githubCreatedAt` DATETIME(3) NULL,
    `githubFetchedAt` DATETIME(3) NULL,
    `githubProfileSyncedAt` DATETIME(3) NULL,
    `trustedPublisher` BOOLEAN NOT NULL DEFAULT false,
    `publishedSkills` INTEGER NOT NULL DEFAULT 0,
    `totalStars` INTEGER NOT NULL DEFAULT 0,
    `totalDownloads` INTEGER NOT NULL DEFAULT 0,
    `personalPublisherId` VARCHAR(191) NULL,
    `requiresModerationAt` DATETIME(3) NULL,
    `requiresModerationReason` VARCHAR(191) NULL,
    `deactivatedAt` DATETIME(3) NULL,
    `purgedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `banReason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_phone_key`(`phone`),
    UNIQUE INDEX `users_handle_key`(`handle`),
    INDEX `users_handle_idx`(`handle`),
    INDEX `users_email_idx`(`email`),
    INDEX `users_phone_idx`(`phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `publishers` (
    `id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL DEFAULT 'user',
    `handle` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `bio` VARCHAR(191) NULL,
    `image` VARCHAR(191) NULL,
    `linkedUserId` VARCHAR(191) NULL,
    `trustedPublisher` BOOLEAN NOT NULL DEFAULT false,
    `publishedSkills` INTEGER NOT NULL DEFAULT 0,
    `publishedPackages` INTEGER NOT NULL DEFAULT 0,
    `totalInstalls` INTEGER NOT NULL DEFAULT 0,
    `totalDownloads` INTEGER NOT NULL DEFAULT 0,
    `totalStars` INTEGER NOT NULL DEFAULT 0,
    `skillTotalInstalls` INTEGER NOT NULL DEFAULT 0,
    `skillTotalDownloads` INTEGER NOT NULL DEFAULT 0,
    `skillTotalStars` INTEGER NOT NULL DEFAULT 0,
    `deactivatedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `publishers_handle_key`(`handle`),
    INDEX `publishers_handle_idx`(`handle`),
    INDEX `publishers_linkedUserId_idx`(`linkedUserId`),
    INDEX `publishers_kind_idx`(`kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `publisherMembers` (
    `id` VARCHAR(191) NOT NULL,
    `publisherId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'publisher',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `publisherMembers_publisherId_idx`(`publisherId`),
    INDEX `publisherMembers_userId_idx`(`userId`),
    UNIQUE INDEX `publisherMembers_publisherId_userId_key`(`publisherId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `officialPublishers` (
    `id` VARCHAR(191) NOT NULL,
    `publisherId` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `officialPublishers_publisherId_key`(`publisherId`),
    INDEX `officialPublishers_publisherId_idx`(`publisherId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skills` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `summary` VARCHAR(191) NULL,
    `icon` VARCHAR(191) NULL,
    `resourceId` VARCHAR(191) NULL,
    `ownerUserId` VARCHAR(191) NOT NULL,
    `ownerPublisherId` VARCHAR(191) NULL,
    `canonicalSkillId` VARCHAR(191) NULL,
    `forkOfSkillId` VARCHAR(191) NULL,
    `forkOfKind` VARCHAR(191) NULL,
    `forkOfVersion` VARCHAR(191) NULL,
    `forkOfAt` DATETIME(3) NULL,
    `installKind` VARCHAR(191) NULL,
    `githubSourceId` VARCHAR(191) NULL,
    `githubPath` VARCHAR(191) NULL,
    `githubHasSkillCard` BOOLEAN NULL,
    `githubCurrentCommit` VARCHAR(191) NULL,
    `githubCurrentContentHash` VARCHAR(191) NULL,
    `githubCurrentStatus` VARCHAR(191) NULL,
    `githubCurrentCheckedAt` DATETIME(3) NULL,
    `githubScanStatus` VARCHAR(191) NULL,
    `githubRemovedAt` DATETIME(3) NULL,
    `latestVersionId` VARCHAR(191) NULL,
    `latestVersionSummary` JSON NULL,
    `tags` JSON NULL,
    `capabilityTags` JSON NULL,
    `softDeletedAt` DATETIME(3) NULL,
    `moderationStatus` VARCHAR(191) NULL,
    `moderationNotes` VARCHAR(191) NULL,
    `moderationReason` VARCHAR(191) NULL,
    `moderationVerdict` VARCHAR(191) NULL,
    `moderationReasonCodes` JSON NULL,
    `moderationEvidence` JSON NULL,
    `moderationSummary` VARCHAR(191) NULL,
    `moderationEngineVersion` VARCHAR(191) NULL,
    `moderationEvaluatedAt` DATETIME(3) NULL,
    `manualOverride` JSON NULL,
    `quality` JSON NULL,
    `isSuspicious` BOOLEAN NULL,
    `moderationFlags` JSON NULL,
    `lastReviewedAt` DATETIME(3) NULL,
    `scanLastCheckedAt` DATETIME(3) NULL,
    `scanCheckCount` INTEGER NULL,
    `hiddenAt` DATETIME(3) NULL,
    `hiddenBy` VARCHAR(191) NULL,
    `unpublishedSlugReservedUntil` DATETIME(3) NULL,
    `unpublishedSlugReleasedAt` DATETIME(3) NULL,
    `unpublishedOriginalSlug` VARCHAR(191) NULL,
    `reportCount` INTEGER NOT NULL DEFAULT 0,
    `lastReportedAt` DATETIME(3) NULL,
    `batch` VARCHAR(191) NULL,
    `statsDownloads` INTEGER NOT NULL DEFAULT 0,
    `statsStars` INTEGER NOT NULL DEFAULT 0,
    `statsInstallsCurrent` INTEGER NOT NULL DEFAULT 0,
    `statsInstallsAllTime` INTEGER NOT NULL DEFAULT 0,
    `statsVersions` INTEGER NOT NULL DEFAULT 0,
    `statsComments` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `skills_ownerPublisherId_idx`(`ownerPublisherId`),
    INDEX `skills_slug_idx`(`slug`),
    INDEX `skills_statsDownloads_idx`(`statsDownloads`),
    INDEX `skills_statsStars_idx`(`statsStars`),
    INDEX `skills_statsInstallsAllTime_idx`(`statsInstallsAllTime`),
    INDEX `skills_softDeletedAt_idx`(`softDeletedAt`),
    INDEX `skills_moderationStatus_idx`(`moderationStatus`),
    UNIQUE INDEX `skills_ownerUserId_slug_key`(`ownerUserId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skillVersions` (
    `id` VARCHAR(191) NOT NULL,
    `skillId` VARCHAR(191) NOT NULL,
    `version` VARCHAR(191) NOT NULL,
    `fingerprint` VARCHAR(191) NULL,
    `sourceProvenance` JSON NULL,
    `changelog` VARCHAR(191) NOT NULL DEFAULT '',
    `changelogSource` VARCHAR(191) NULL,
    `icon` VARCHAR(191) NULL,
    `files` JSON NOT NULL,
    `parsed` JSON NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `clawScanNote` VARCHAR(191) NULL,
    `clawScanNoteUpdatedAt` DATETIME(3) NULL,
    `softDeletedAt` DATETIME(3) NULL,
    `sha256hash` VARCHAR(191) NULL,
    `vtAnalysis` JSON NULL,
    `skillSpectorAnalysis` JSON NULL,
    `llmAnalysis` JSON NULL,
    `capabilityTags` JSON NULL,
    `depRegistryAnalysis` JSON NULL,
    `depRegistryScanStatus` VARCHAR(191) NULL,
    `staticScan` JSON NULL,
    `apiKeyRequired` BOOLEAN NULL,

    INDEX `skillVersions_skillId_idx`(`skillId`),
    INDEX `skillVersions_sha256hash_idx`(`sha256hash`),
    UNIQUE INDEX `skillVersions_skillId_version_key`(`skillId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skillEmbeddings` (
    `id` VARCHAR(191) NOT NULL,
    `skillId` VARCHAR(191) NOT NULL,
    `versionId` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `ownerPublisherId` VARCHAR(191) NULL,
    `embedding` JSON NOT NULL,
    `isLatest` BOOLEAN NOT NULL DEFAULT true,
    `isApproved` BOOLEAN NOT NULL DEFAULT true,
    `visibility` VARCHAR(191) NOT NULL DEFAULT 'public',
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `skillEmbeddings_skillId_idx`(`skillId`),
    INDEX `skillEmbeddings_versionId_idx`(`versionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skillBadges` (
    `id` VARCHAR(191) NOT NULL,
    `skillId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `byUserId` VARCHAR(191) NOT NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `skillBadges_skillId_idx`(`skillId`),
    INDEX `skillBadges_kind_idx`(`kind`),
    UNIQUE INDEX `skillBadges_skillId_kind_key`(`skillId`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `comments` (
    `id` VARCHAR(191) NOT NULL,
    `skillId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `body` VARCHAR(191) NOT NULL,
    `reportCount` INTEGER NOT NULL DEFAULT 0,
    `lastReportedAt` DATETIME(3) NULL,
    `scamScanVerdict` VARCHAR(191) NULL,
    `scamScanConfidence` VARCHAR(191) NULL,
    `scamScanExplanation` VARCHAR(191) NULL,
    `scamScanEvidence` JSON NULL,
    `scamScanModel` VARCHAR(191) NULL,
    `scamScanCheckedAt` DATETIME(3) NULL,
    `scamBanTriggeredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `softDeletedAt` DATETIME(3) NULL,
    `deletedBy` VARCHAR(191) NULL,

    INDEX `comments_skillId_idx`(`skillId`),
    INDEX `comments_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `commentReports` (
    `id` VARCHAR(191) NOT NULL,
    `commentId` VARCHAR(191) NOT NULL,
    `skillId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `commentReports_commentId_idx`(`commentId`),
    INDEX `commentReports_skillId_idx`(`skillId`),
    INDEX `commentReports_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stars` (
    `id` VARCHAR(191) NOT NULL,
    `skillId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `stars_skillId_idx`(`skillId`),
    INDEX `stars_userId_idx`(`userId`),
    UNIQUE INDEX `stars_skillId_userId_key`(`skillId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skillReports` (
    `id` VARCHAR(191) NOT NULL,
    `skillId` VARCHAR(191) NOT NULL,
    `skillVersionId` VARCHAR(191) NULL,
    `version` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `status` VARCHAR(191) NULL DEFAULT 'open',
    `triagedAt` DATETIME(3) NULL,
    `triagedBy` VARCHAR(191) NULL,
    `triageNote` VARCHAR(191) NULL,
    `actionTaken` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `skillReports_skillId_idx`(`skillId`),
    INDEX `skillReports_userId_idx`(`userId`),
    INDEX `skillReports_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skillAppeals` (
    `id` VARCHAR(191) NOT NULL,
    `skillId` VARCHAR(191) NOT NULL,
    `skillVersionId` VARCHAR(191) NULL,
    `version` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NOT NULL,
    `message` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `resolvedAt` DATETIME(3) NULL,
    `resolvedBy` VARCHAR(191) NULL,
    `resolutionNote` VARCHAR(191) NULL,
    `actionTaken` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `skillAppeals_skillId_idx`(`skillId`),
    INDEX `skillAppeals_userId_idx`(`userId`),
    INDEX `skillAppeals_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `packages` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `normalizedName` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `summary` VARCHAR(191) NULL,
    `ownerUserId` VARCHAR(191) NOT NULL,
    `ownerPublisherId` VARCHAR(191) NULL,
    `family` VARCHAR(191) NOT NULL DEFAULT 'skill',
    `channel` VARCHAR(191) NOT NULL DEFAULT 'community',
    `isOfficial` BOOLEAN NOT NULL DEFAULT false,
    `runtimeId` VARCHAR(191) NULL,
    `sourceRepo` VARCHAR(191) NULL,
    `latestReleaseId` VARCHAR(191) NULL,
    `latestVersionSummary` JSON NULL,
    `tags` JSON NULL,
    `capabilityTags` JSON NULL,
    `executesCode` BOOLEAN NULL,
    `compatibility` JSON NULL,
    `capabilities` JSON NULL,
    `verification` JSON NULL,
    `scanStatus` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `stats` JSON NOT NULL,
    `reportCount` INTEGER NOT NULL DEFAULT 0,
    `lastReportedAt` DATETIME(3) NULL,
    `softDeletedAt` DATETIME(3) NULL,
    `softDeletedReason` VARCHAR(191) NULL,
    `softDeletedBy` VARCHAR(191) NULL,
    `softDeletedByRole` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `packages_normalizedName_key`(`normalizedName`),
    INDEX `packages_normalizedName_idx`(`normalizedName`),
    INDEX `packages_ownerUserId_idx`(`ownerUserId`),
    INDEX `packages_ownerPublisherId_idx`(`ownerPublisherId`),
    INDEX `packages_family_idx`(`family`),
    INDEX `packages_channel_idx`(`channel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `packageReleases` (
    `id` VARCHAR(191) NOT NULL,
    `packageId` VARCHAR(191) NOT NULL,
    `version` VARCHAR(191) NOT NULL,
    `changelog` VARCHAR(191) NOT NULL DEFAULT '',
    `summary` VARCHAR(191) NULL,
    `distTags` JSON NULL,
    `files` JSON NOT NULL,
    `integritySha256` VARCHAR(191) NOT NULL,
    `artifactKind` VARCHAR(191) NULL,
    `clawpackStorageId` VARCHAR(191) NULL,
    `clawpackSha256` VARCHAR(191) NULL,
    `clawpackSize` INTEGER NULL,
    `clawpackFormat` VARCHAR(191) NULL,
    `npmIntegrity` VARCHAR(191) NULL,
    `npmShasum` VARCHAR(191) NULL,
    `npmTarballName` VARCHAR(191) NULL,
    `npmUnpackedSize` INTEGER NULL,
    `npmFileCount` INTEGER NULL,
    `extractedPackageJson` JSON NULL,
    `extractedPluginManifest` JSON NULL,
    `normalizedBundleManifest` JSON NULL,
    `compatibility` JSON NULL,
    `capabilities` JSON NULL,
    `runtimeId` VARCHAR(191) NULL,
    `sourceRepo` VARCHAR(191) NULL,
    `verification` JSON NULL,
    `sha256hash` VARCHAR(191) NULL,
    `vtAnalysis` JSON NULL,
    `skillSpectorAnalysis` JSON NULL,
    `llmAnalysis` JSON NULL,
    `staticScan` JSON NULL,
    `manualModeration` JSON NULL,
    `source` JSON NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `publishActor` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `clawScanNote` VARCHAR(191) NULL,
    `clawScanNoteUpdatedAt` DATETIME(3) NULL,
    `softDeletedAt` DATETIME(3) NULL,

    INDEX `packageReleases_packageId_idx`(`packageId`),
    UNIQUE INDEX `packageReleases_packageId_version_key`(`packageId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skillDailyStats` (
    `id` VARCHAR(191) NOT NULL,
    `skillId` VARCHAR(191) NOT NULL,
    `day` DATE NOT NULL,
    `downloads` INTEGER NOT NULL DEFAULT 0,
    `installs` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `skillDailyStats_day_idx`(`day`),
    UNIQUE INDEX `skillDailyStats_skillId_day_key`(`skillId`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skillStatEvents` (
    `id` VARCHAR(191) NOT NULL,
    `skillId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `delta` JSON NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,

    INDEX `skillStatEvents_processedAt_idx`(`processedAt`),
    INDEX `skillStatEvents_skillId_idx`(`skillId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `globalStats` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `activeSkillsCount` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `globalStats_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `apiTokens` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `prefix` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `apiTokens_tokenHash_key`(`tokenHash`),
    INDEX `apiTokens_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rateLimits` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `windowStart` DATETIME(3) NOT NULL,
    `shard` INTEGER NULL,
    `count` INTEGER NOT NULL DEFAULT 0,
    `limit` INTEGER NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rateLimits_key_idx`(`key`),
    UNIQUE INDEX `rateLimits_key_windowStart_key`(`key`, `windowStart`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reservedSlugs` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `originalOwnerUserId` VARCHAR(191) NOT NULL,
    `deletedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `releasedAt` DATETIME(3) NULL,

    UNIQUE INDEX `reservedSlugs_slug_key`(`slug`),
    INDEX `reservedSlugs_slug_idx`(`slug`),
    INDEX `reservedSlugs_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reservedHandles` (
    `id` VARCHAR(191) NOT NULL,
    `handle` VARCHAR(191) NOT NULL,
    `rightfulOwnerUserId` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `releasedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `reservedHandles_handle_key`(`handle`),
    INDEX `reservedHandles_handle_idx`(`handle`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auditLogs` (
    `id` VARCHAR(191) NOT NULL,
    `actorUserId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `targetType` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `auditLogs_actorUserId_idx`(`actorUserId`),
    INDEX `auditLogs_targetType_targetId_idx`(`targetType`, `targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `publishers` ADD CONSTRAINT `publishers_linkedUserId_fkey` FOREIGN KEY (`linkedUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `publisherMembers` ADD CONSTRAINT `publisherMembers_publisherId_fkey` FOREIGN KEY (`publisherId`) REFERENCES `publishers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `publisherMembers` ADD CONSTRAINT `publisherMembers_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `officialPublishers` ADD CONSTRAINT `officialPublishers_publisherId_fkey` FOREIGN KEY (`publisherId`) REFERENCES `publishers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `skills` ADD CONSTRAINT `skills_ownerUserId_fkey` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `skills` ADD CONSTRAINT `skills_ownerPublisherId_fkey` FOREIGN KEY (`ownerPublisherId`) REFERENCES `publishers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `skills` ADD CONSTRAINT `skills_canonicalSkillId_fkey` FOREIGN KEY (`canonicalSkillId`) REFERENCES `skills`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `skillVersions` ADD CONSTRAINT `skillVersions_skillId_fkey` FOREIGN KEY (`skillId`) REFERENCES `skills`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `skillVersions` ADD CONSTRAINT `skillVersions_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `skillEmbeddings` ADD CONSTRAINT `skillEmbeddings_skillId_fkey` FOREIGN KEY (`skillId`) REFERENCES `skills`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `skillBadges` ADD CONSTRAINT `skillBadges_skillId_fkey` FOREIGN KEY (`skillId`) REFERENCES `skills`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `skillBadges` ADD CONSTRAINT `skillBadges_byUserId_fkey` FOREIGN KEY (`byUserId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `comments` ADD CONSTRAINT `comments_skillId_fkey` FOREIGN KEY (`skillId`) REFERENCES `skills`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `comments` ADD CONSTRAINT `comments_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `commentReports` ADD CONSTRAINT `commentReports_commentId_fkey` FOREIGN KEY (`commentId`) REFERENCES `comments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stars` ADD CONSTRAINT `stars_skillId_fkey` FOREIGN KEY (`skillId`) REFERENCES `skills`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stars` ADD CONSTRAINT `stars_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `skillReports` ADD CONSTRAINT `skillReports_skillId_fkey` FOREIGN KEY (`skillId`) REFERENCES `skills`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `skillReports` ADD CONSTRAINT `skillReports_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `skillAppeals` ADD CONSTRAINT `skillAppeals_skillId_fkey` FOREIGN KEY (`skillId`) REFERENCES `skills`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `skillAppeals` ADD CONSTRAINT `skillAppeals_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `packages` ADD CONSTRAINT `packages_ownerUserId_fkey` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `packages` ADD CONSTRAINT `packages_ownerPublisherId_fkey` FOREIGN KEY (`ownerPublisherId`) REFERENCES `publishers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `packageReleases` ADD CONSTRAINT `packageReleases_packageId_fkey` FOREIGN KEY (`packageId`) REFERENCES `packages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `skillDailyStats` ADD CONSTRAINT `skillDailyStats_skillId_fkey` FOREIGN KEY (`skillId`) REFERENCES `skills`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `skillStatEvents` ADD CONSTRAINT `skillStatEvents_skillId_fkey` FOREIGN KEY (`skillId`) REFERENCES `skills`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `apiTokens` ADD CONSTRAINT `apiTokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
