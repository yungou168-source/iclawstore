-- Preserve the canonical source URL required for strict projection reconciliation.
-- Expand-only: this does not enable MySQL reads or change any write authority.
ALTER TABLE `profile_catalog_items`
  ADD COLUMN `sourceHref` VARCHAR(2048) NOT NULL AFTER `icon`;

ALTER TABLE `profile_starred_items`
  ADD COLUMN `sourceHref` VARCHAR(2048) NOT NULL AFTER `icon`;