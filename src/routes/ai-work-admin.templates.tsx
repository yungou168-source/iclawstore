import { createFileRoute } from "@tanstack/react-router";
import { TemplateReviewPage } from "../components/ai-direct/TemplateReviewPage";

export const Route = createFileRoute("/ai-work-admin/templates")({
  component: TemplateReviewPage,
});
