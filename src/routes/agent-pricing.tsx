import { createFileRoute } from "@tanstack/react-router";
import { DeveloperPricingPage } from "../components/ai-direct/DeveloperPricingPage";

export const Route = createFileRoute("/agent-pricing")({
  component: DeveloperPricingPage,
});
