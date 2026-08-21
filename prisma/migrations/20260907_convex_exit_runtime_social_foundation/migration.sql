-- Candidate-only facts for Soul social/moderation and controlled workers.
CREATE TABLE IF NOT EXISTS migration_social_facts (
  id VARCHAR(36) NOT NULL, domainObjectType VARCHAR(32) NOT NULL, objectLegacyId VARCHAR(191) NOT NULL,
  actorLegacyId VARCHAR(191) NOT NULL, action VARCHAR(32) NOT NULL, body TEXT NULL,
  state VARCHAR(32) NOT NULL DEFAULT 'active', sourceHash CHAR(64) NOT NULL, batchId VARCHAR(36) NOT NULL,
  createdAt DATETIME(3) NOT NULL, updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id), UNIQUE KEY migration_social_fact_key (domainObjectType, objectLegacyId, actorLegacyId, action), KEY migration_social_batch_idx (batchId)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS migration_moderation_cases (
  id VARCHAR(36) NOT NULL, subjectType VARCHAR(32) NOT NULL, subjectLegacyId VARCHAR(191) NOT NULL,
  reporterLegacyId VARCHAR(191) NOT NULL, caseType VARCHAR(32) NOT NULL, reason TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open', decision VARCHAR(32) NULL, assignedToLegacyId VARCHAR(191) NULL,
  sourceHash CHAR(64) NOT NULL, batchId VARCHAR(36) NOT NULL, createdAt DATETIME(3) NOT NULL,
  resolvedAt DATETIME(3) NULL, PRIMARY KEY (id), UNIQUE KEY moderation_case_key (subjectType, subjectLegacyId, reporterLegacyId, caseType), KEY moderation_status_idx (status, createdAt)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS migration_moderation_evidence (
  id VARCHAR(36) NOT NULL, caseId VARCHAR(36) NOT NULL, evidenceType VARCHAR(32) NOT NULL,
  digest CHAR(64) NOT NULL, metadata JSON NOT NULL, createdAt DATETIME(3) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY moderation_evidence_key (caseId, evidenceType, digest),
  CONSTRAINT moderation_evidence_case_fk FOREIGN KEY (caseId) REFERENCES migration_moderation_cases(id) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS migration_audit_events (
  id VARCHAR(36) NOT NULL, domainName VARCHAR(64) NOT NULL, action VARCHAR(64) NOT NULL,
  subjectType VARCHAR(64) NOT NULL, subjectId VARCHAR(191) NOT NULL, actorId VARCHAR(191) NULL,
  requestId VARCHAR(191) NULL, payload JSON NOT NULL, eventHash CHAR(64) NOT NULL, createdAt DATETIME(3) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY audit_event_hash_key (eventHash), KEY audit_subject_idx (subjectType, subjectId, createdAt)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS migration_worker_leases (
  workerName VARCHAR(128) NOT NULL, ownerId VARCHAR(191) NOT NULL, token CHAR(36) NOT NULL,
  expiresAt DATETIME(3) NOT NULL, updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (workerName), KEY worker_lease_expiry_idx (expiresAt)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS migration_checkpoints (
  workerName VARCHAR(128) NOT NULL, cursorValue VARCHAR(1024) NULL, watermark VARCHAR(191) NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE, updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (workerName)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;