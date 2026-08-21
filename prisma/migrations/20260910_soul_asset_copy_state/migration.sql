-- Candidate-only asset copy state details. No public route or read cutover is enabled.
ALTER TABLE `soul_version_file_snapshots`
  ADD COLUMN `assetReferenceErrorKind` VARCHAR(64) NULL,
  ADD COLUMN `assetReferenceError` VARCHAR(500) NULL;