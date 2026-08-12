import { createFileRoute, notFound } from "@tanstack/react-router";
import { Bot, CalendarDays } from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "../../components/ui/avatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import {
  aiDirectPaidHiringApi,
  type CandidateCatalogItemDto,
} from "../../lib/aiDirectPaidHiringApi";
import { getPublicProfile, type PublicProfile } from "../../lib/publicProfileApi";

export const Route = createFileRoute("/profile/$slug")({
  loader: async ({ params }) => {
    const profile = await getPublicProfile(params.slug);
    if (!profile) throw notFound();
    return { profile };
  },
  component: PublicProfilePage,
});

function PublicProfilePage() {
  const { profile } = Route.useLoaderData() as { profile: PublicProfile };
  const [agents, setAgents] = useState<CandidateCatalogItemDto[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const displayName =
    profile.user.displayName ?? profile.user.name ?? profile.user.handle ?? "用户";

  useEffect(() => {
    let active = true;
    void aiDirectPaidHiringApi
      .listPublicAgentsByUser(profile.user._id)
      .then((result) => {
        if (active) setAgents(result.items);
      })
      .finally(() => {
        if (active) setLoadingAgents(false);
      });
    return () => {
      active = false;
    };
  }, [profile.user._id]);

  return (
    <main className="section">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <Card>
          <CardContent className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
            <Avatar className="h-24 w-24">
              {profile.user.image ? (
                <AvatarImage src={profile.user.image} alt={displayName} />
              ) : null}
              <AvatarFallback>{displayName.charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-muted-foreground">
                @{profile.user.handle ?? profile.profileSlug}
              </p>
              <h1 className="text-3xl font-bold">{displayName}</h1>
              {profile.user.bio ? (
                <p className="mt-3 max-w-2xl text-muted-foreground">{profile.user.bio}</p>
              ) : null}
              <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarDays className="h-4 w-4" aria-hidden="true" />
                加入于 {new Date(profile.user._creationTime).toLocaleDateString("zh-CN")}
              </p>
            </div>
          </CardContent>
        </Card>

        <section aria-labelledby="profile-agents-title">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 id="profile-agents-title" className="text-2xl font-bold">
                名下 AI 员工
              </h2>
              <p className="text-sm text-muted-foreground">仅展示已公开且当前可用的 AI 员工。</p>
            </div>
            <span className="text-sm text-muted-foreground">{agents.length} 个</span>
          </div>
          {loadingAgents ? (
            <p className="text-sm text-muted-foreground">正在加载 AI 员工…</p>
          ) : agents.length ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {agents.map((agent) => (
                <Card key={agent.agentId}>
                  <CardHeader>
                    <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                      <Bot className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <CardTitle>{agent.displayName}</CardTitle>
                    <CardDescription>{agent.category ?? "通用 AI 员工"}</CardDescription>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    {agent.summary ?? "暂无介绍"}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                该用户暂时没有公开 AI 员工。
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </main>
  );
}
