-- Independent Soul migration control plane. No Convex transport or runtime dependency.
CREATE TABLE IF NOT EXISTS soul_migration_checkpoints (
  batchId VARCHAR(36) NOT NULL,
  jobKind VARCHAR(64) NOT NULL,
  cursorValue TEXT NULL,
  watermark VARCHAR(191) NULL,
  completedAt DATETIME(3) NULL,
  failedAt DATETIME(3) NULL,
  failureCode VARCHAR(128) NULL,
  pageCount BIGINT NOT NULL DEFAULT 0,
  importedCount BIGINT NOT NULL DEFAULT 0,
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (batchId, jobKind),
  KEY soul_migration_checkpoint_status_idx (jobKind, completedAt, failedAt),
  CONSTRAINT soul_migration_checkpoint_batch_fk FOREIGN KEY (batchId)
    REFERENCES convex_exit_migration_batches(id) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS soul_migration_reports (
  id VARCHAR(36) NOT NULL,
  batchId VARCHAR(36) NOT NULL,
  jobKind VARCHAR(64) NOT NULL,
  watermark VARCHAR(191) NULL,
  sourceCount BIGINT NOT NULL,
  targetCount BIGINT NOT NULL,
  differenceCount BIGINT NOT NULL,
  missingAssetCount BIGINT NOT NULL,
  candidateReady BOOLEAN NOT NULL DEFAULT FALSE,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY soul_migration_report_batch_job_key (batchId, jobKind),
  KEY soul_migration_report_gate_idx (candidateReady, updatedAt),
  CONSTRAINT soul_migration_report_batch_fk FOREIGN KEY (batchId)
    REFERENCES convex_exit_migration_batches(id) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;