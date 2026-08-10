import { createFileRoute } from "@tanstack/react-router";
import { AuditCenterPage } from "../components/ai-direct/AuditCenterPage";

type AuditSearch = { organizationId?: string };

export const Route = createFileRoute("/ai-work-admin/audit")({
  validateSearch: (search): AuditSearch => ({
    organizationId: typeof search.organizationId === "string" ? search.organizationId : undefined,
  }),
  component: AiWorkAdminAuditRoute,
});

function AiWorkAdminAuditRoute() {
  const search = Route.useSearch();
  return <AuditCenterPage initialOrganizationId={search.organizationId} />;
}
