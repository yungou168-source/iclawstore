-- Cursor pagination for organization-scoped desktop Job history.
-- The existing (organizationId, createdAt) index cannot deterministically seek ties.
CREATE INDEX `ai_direct_workflow_runs_organization_cursor_idx`
  ON `ai_direct_workflow_runs`(`organizationId`, `createdAt`, `id`);