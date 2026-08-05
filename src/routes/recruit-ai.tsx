import { createFileRoute } from '@tanstack/react-router';
import { RecruitAiDirectory } from '../components/RecruitAiDirectory';

export const Route = createFileRoute('/recruit-ai')({
  component: RecruitAiPage,
});

function RecruitAiPage() {
  return <RecruitAiDirectory />;
}