-- Candidate-only, append-only attestation for a narrowly verified historical fixture cleanup.
-- This table does not delete, update, resolve, or waive migration evidence.
CREATE TABLE `candidate_fixture_retention_records` (
  `id` VARCHAR(36) NOT NULL,
  `domain` VARCHAR(64) NOT NULL,
  `legacyConvexId` VARCHAR(191) NOT NULL,
  `snapshotId` VARCHAR(36) NOT NULL,
  `fixtureIdentifier` VARCHAR(64) NOT NULL,
  `fixtureMarker` VARCHAR(128) NOT NULL,
  `cleanupConfirmation` VARCHAR(128) NOT NULL,
  `cleanupReason` VARCHAR(512) NOT NULL,
  `outboxEventId` VARCHAR(36) NOT NULL,
  `outboxFailureCode` VARCHAR(128) NOT NULL,
  `confirmedBy` VARCHAR(191) NOT NULL,
  `confirmedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `candidate_fixture_retention_domain_legacy_key` (`domain`, `legacyConvexId`),
  UNIQUE KEY `candidate_fixture_retention_domain_snapshot_key` (`domain`, `snapshotId`),
  UNIQUE KEY `candidate_fixture_retention_outbox_key` (`outboxEventId`),
  KEY `candidate_fixture_retention_lookup_idx` (`domain`, `legacyConvexId`, `fixtureIdentifier`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `profile_reconciliation_reports`
  ADD COLUMN `retainedFixtureDifferenceCount` BIGINT NOT NULL DEFAULT 0
  AFTER `unclassifiedDifferenceCount`;