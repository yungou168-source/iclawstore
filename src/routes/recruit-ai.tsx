import { createFileRoute } from "@tanstack/react-router";
import { RecruitPaidHiringFlow } from "../components/RecruitPaidHiringFlow";

export const Route = createFileRoute("/recruit-ai")({
  component: RecruitAiPage,
});

function RecruitAiPage() {
  return <RecruitPaidHiringFlow />;
}
