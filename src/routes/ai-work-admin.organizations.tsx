import { createFileRoute } from "@tanstack/react-router";
import { OrganizationAdminPage } from "../components/ai-direct/OrganizationAdminPage";

export const Route = createFileRoute("/ai-work-admin/organizations")({
  component: OrganizationAdminPage,
});
