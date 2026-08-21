-- Prevent an expired avatar worker from committing after another worker reclaims its lease.
-- Expand-only; this migration is not executed by source changes.

ALTER TABLE `convex_exit_outbox_events`
  ADD COLUMN `claimToken` VARCHAR(36) NULL AFTER `claimedAt`;