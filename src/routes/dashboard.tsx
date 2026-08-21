import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import {
  AlertTriangle,
  Bot,
  Box,
  Building2,
  Globe2,
  Loader2,
  Package,
  Plus,
  Settings,
  Star,
  UserCheck,
  WalletCards,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { ArtifactCard } from "../components/artifacts/ArtifactCard";
import { packageArtifactStatus, skillArtifactStatus } from "../components/artifacts/artifactStatus";
import { SignInPrompt } from "../components/SignInPrompt";
import { DashboardSkeleton } from "../components/skeletons/DashboardSkeleton";
import { buildSkillHref } from "../components/skillDetailUtils";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { aiDirectPaidHiringApi, type OwnedAgentDto } from "../lib/aiDirectPaidHiringApi";
import { t } from "../lib/i18n";
import { useLocale } from "../lib/i18n/context";
import { buildPluginDetailHref, buildPluginValidationHref } from "../lib/pluginRoutes";
import { useAuthStatus } from "../lib/useAuthStatus";

const emptyPluginPublishSearch = {
  ownerHandle: undefined,
  name: undefined,
  displayName: undefined,
  family: undefined,
  nextVersion: undefined,
  sourceRepo: undefined,
} as const;

type DashboardSkill = Pick<
  Doc<"skills">,
  | "_id"
  | "_creationTime"
  | "slug"
  | "displayName"
  | "summary"
  | "ownerUserId"
  | "ownerPublisherId"
  | "canonicalSkillId"
  | "forkOf"
  | "latestVersionId"
  | "tags"
  | "capabilityTags"
  | "badges"
  | "stats"
  | "moderationStatus"
  | "moderationReason"
  | "moderationVerdict"
  | "moderationFlags"
  | "isSuspicious"
  | "createdAt"
  | "updatedAt"
> & {
  ownerPath: string;
  detailHref?: string;
  settingsHref?: string;
  pendingReview?: boolean;
  qualityDecision?: "pass" | "quarantine" | "reject";
  latestVersion: {
    version: string;
    createdAt: number;
    vtStatus: string | null;
    llmStatus: string | null;
    staticScanStatus: "clean" | "suspicious" | "malicious" | null;
  } | null;
};

type DashboardPackage = {
  _id: string;
  name: string;
  displayName: string;
  family: "skill" | "code-plugin" | "bundle-plugin";
  channel: "official" | "community" | "private";
  isOfficial: boolean;
  runtimeId?: string | null;
  sourceRepo?: string | null;
  summary?: string | null;
  latestVersion?: string | null;
  inspectorWarningCount?: number;
  updatedAt: number;
  stats: {
    downloads: number;
    installs: number;
    stars: number;
    versions: number;
  };
  verification?: {
    tier?: "structural" | "source-linked" | "provenance-verified" | "rebuild-verified";
  } | null;
  scanStatus?: "clean" | "suspicious" | "malicious" | "pending" | "not-run";
  pendingReview?: boolean;
  latestRelease: {
    version: string;
    createdAt: number;
    vtStatus: string | null;
    llmStatus: string | null;
    staticScanStatus: "clean" | "suspicious" | "malicious" | null;
  } | null;
};

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

export function Dashboard() {
  const { locale } = useLocale();
  const { isAuthenticated, isLoading: isAuthLoading, me } = useAuthStatus();
  const publishers = useQuery(api.publishers.listMine, me ? {} : "skip") as
    | Array<{
        publisher: {
          _id: string;
          handle: string;
          displayName: string;
          kind: "user" | "org";
        };
        role: "owner" | "admin" | "publisher";
      }>
    | undefined;
  const [selectedPublisherId, setSelectedPublisherId] = useState<string>("");
  const defaultPublisher =
    publishers?.find((entry) => entry.publisher.kind === "user") ?? publishers?.[0] ?? null;
  const selectedPublisherFromState = selectedPublisherId
    ? (publishers?.find((entry) => entry.publisher._id === selectedPublisherId) ?? null)
    : null;
  const selectedPublisher = selectedPublisherFromState ?? defaultPublisher ?? null;
  const activePublisherId = selectedPublisher?.publisher._id ?? "";

  const skillsQueryArgs =
    selectedPublisher?.publisher.kind === "user" && me?._id
      ? { ownerUserId: me._id }
      : activePublisherId
        ? { ownerPublisherId: activePublisherId as Doc<"publishers">["_id"] }
        : me?._id
          ? { ownerUserId: me._id }
          : "skip";
  const {
    results: paginatedSkills,
    status: skillsStatus,
    loadMore,
  } = usePaginatedQuery(api.skills.listDashboardPaginated, skillsQueryArgs, {
    initialNumItems: 50,
  });
  const mySkills = paginatedSkills as DashboardSkill[] | undefined;
  const myPackages = useQuery(
    api.packages.list,
    activePublisherId
      ? { ownerPublisherId: activePublisherId as Doc<"publishers">["_id"], limit: 100 }
      : me?._id
        ? { ownerUserId: me._id, limit: 100 }
        : "skip",
  ) as DashboardPackage[] | undefined;

  if (isAuthLoading) {
    return <DashboardSkeleton />;
  }

  if (!isAuthenticated || !me) {
    return <SignInPrompt title={t("dashboard.sign_in_to_continue", locale)} />;
  }

  const skills = mySkills ?? [];
  const packages = myPackages ?? [];
  const isLoading =
    publishers === undefined || skillsStatus === "LoadingFirstPage" || myPackages === undefined;
  const ownerHandle =
    selectedPublisher?.publisher.handle ?? me.handle ?? me.name ?? me.displayName ?? me._id;
  const isDashboardEmpty = !isLoading && skills.length === 0 && packages.length === 0;

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  const publisherSelector =
    publishers && publishers.length > 1 ? (
      <div className="dashboard-publisher-select">
        <span className="text-sm font-medium text-muted-foreground">
          {t("dashboard.viewing_as", locale)}
        </span>
        <Select value={activePublisherId} onValueChange={setSelectedPublisherId}>
          <SelectTrigger
            aria-label="Dashboard publisher"
            className="min-w-[220px] rounded-[var(--radius-sm)]"
          >
            <SelectValue placeholder={t("dashboard.select_publisher", locale)} />
          </SelectTrigger>
          <SelectContent>
            {publishers.map((entry) => (
              <SelectItem key={entry.publisher._id} value={entry.publisher._id}>
                @{entry.publisher.handle} ·{" "}
                {entry.publisher.kind === "org"
                  ? t("dashboard.org", locale)
                  : t("dashboard.personal", locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    ) : null;

  // Welcome state for new users with no content
  if (isDashboardEmpty) {
    return (
      <main className="section">
        <DeveloperCenter approvedByProfile={me.developerStatus === "approved"} />
        <UserCenterEntries profileSlug={me.profileSlug ?? me.handle ?? undefined} />
        <div className="empty-state">
          <h1 className="empty-state-title text-[1.4rem] font-[family-name:var(--font-display)]">
            {t("dashboard.welcome", locale)}
          </h1>
          <p className="empty-state-body">
            {t("dashboard.welcome_message", locale).replace("{handle}", ownerHandle)}
          </p>
          {publisherSelector}
          <div className="flex gap-3 justify-center">
            <Button asChild variant="primary">
              <Link to="/skills/publish" search={{ updateSlug: undefined, ownerHandle }}>
                {t("dashboard.publish_skill", locale)}
              </Link>
            </Button>
            <Button asChild>
              <Link
                to="/skills"
                search={{
                  q: undefined,
                  sort: undefined,
                  dir: undefined,
                  highlighted: undefined,
                  view: undefined,
                  focus: undefined,
                }}
              >
                {t("dashboard.browse_skills", locale)}
              </Link>
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="section">
      <div className="dashboard-header">
        <div>
          <h1 className="section-title m-0">Dashboard</h1>
          <p className="section-subtitle m-0">View your published skills and plugins.</p>
        </div>
        {publisherSelector}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <SummaryCard label="已发布技能" value={skills.length} />
        <SummaryCard label="插件" value={packages.length} />
        <SummaryCard
          label="总下载量"
          value={
            skills.reduce((sum, skill) => sum + (skill.stats?.downloads ?? 0), 0) +
            packages.reduce((sum, pkg) => sum + (pkg.stats.downloads ?? 0), 0)
          }
        />
      </div>
      <DeveloperCenter approvedByProfile={me.developerStatus === "approved"} />
      <UserCenterEntries profileSlug={me.profileSlug ?? me.handle ?? undefined} />

      <div className="dashboard-owner-grid">
        <section className="dashboard-collection-block">
          <div className="dashboard-section-header">
            <h2 className="dashboard-collection-title">Skills</h2>
            <Button asChild size="sm" className="dashboard-section-action">
              <Link to="/skills/publish" search={{ updateSlug: undefined, ownerHandle }}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                New Skill
              </Link>
            </Button>
          </div>
          {skills.length === 0 ? (
            <div className="dashboard-inline-empty">
              <div className="dashboard-inline-empty-copy">
                <strong>No skills yet.</strong> Publish your first skill to share it with the
                community.
              </div>
            </div>
          ) : (
            <div className="dashboard-list">
              {skills.map((skill) => (
                <SkillRow key={skill._id} skill={skill} ownerHandle={ownerHandle} />
              ))}
            </div>
          )}
          {skills.length > 0 && skillsStatus === "CanLoadMore" && (
            <div className="mt-4 flex justify-center">
              <Button onClick={() => loadMore(50)}>Load More</Button>
            </div>
          )}
          {skillsStatus === "LoadingMore" && (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>Loading more skills...</span>
            </div>
          )}
        </section>

        <section className="dashboard-collection-block">
          <div className="dashboard-section-header">
            <h2 className="dashboard-collection-title">Plugins</h2>
            <Button asChild size="sm" className="dashboard-section-action">
              <Link to="/plugins/publish" search={{ ...emptyPluginPublishSearch, ownerHandle }}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                New Plugin
              </Link>
            </Button>
          </div>
          {packages.length === 0 ? (
            <div className="dashboard-inline-empty">
              <div className="dashboard-inline-empty-copy">
                <strong>No plugins yet.</strong> Publish your first plugin release to validate and
                distribute it.
              </div>
            </div>
          ) : (
            <div className="dashboard-list">
              {packages.map((pkg) => (
                <PackageRow key={pkg._id} pkg={pkg} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-3xl font-bold">{formatCompactNumber(value)}</p>
      </CardContent>
    </Card>
  );
}

function UserCenterEntries({ profileSlug }: { profileSlug?: string }) {
  const entries = [
    {
      title: "个人资料设置",
      description: "修改头像、公开介绍和资料页地址",
      icon: Settings,
      content: (
        <Link to="/settings" search={{ view: undefined }}>
          进入设置
        </Link>
      ),
    },
    {
      title: "组织资料设置",
      description: "管理公司中英文名称和组织头像",
      icon: Building2,
      content: (
        <Link to="/settings" search={{ view: "organizations" }}>
          管理组织
        </Link>
      ),
    },
    {
      title: "公开介绍页",
      description: "查看访客无需登录即可访问的个人主页",
      icon: Globe2,
      content: profileSlug ? (
        <Link to="/profile/$slug" params={{ slug: profileSlug }}>
          查看主页
        </Link>
      ) : (
        <Link to="/settings" search={{ view: undefined }}>
          先设置地址
        </Link>
      ),
    },
    {
      title: "我的收藏",
      description: "查看和管理已收藏的技能",
      icon: Star,
      content: (
        <Link to="/stars" search={{ view: undefined, sort: undefined }}>
          查看收藏
        </Link>
      ),
    },
    {
      title: "AI 员工市场",
      description: "浏览公开 AI 员工并进入招聘流程",
      icon: Bot,
      content: <Link to="/recruit-ai">浏览 AI 员工</Link>,
    },
    {
      title: "钱包与账单",
      description: "查看余额、消费记录和开发者收益",
      icon: WalletCards,
      content: (
        <Link to="/wallet" search={{ recharge: undefined }}>
          查看钱包
        </Link>
      ),
    },
  ] as const;

  return (
    <section className="mb-6" aria-labelledby="user-center-entries-title">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 id="user-center-entries-title" className="text-xl font-semibold">
            用户中心入口
          </h2>
          <p className="text-sm text-muted-foreground">
            集中管理个人资料、组织、AI 员工和账户资产。
          </p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {entries.map((entry) => {
          const Icon = entry.icon;
          return (
            <Card key={entry.title} className="h-full">
              <CardContent className="flex h-full flex-col p-4">
                <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
                <h3 className="mt-3 font-semibold">{entry.title}</h3>
                <p className="mt-1 flex-1 text-sm text-muted-foreground">{entry.description}</p>
                <Button asChild variant="ghost" size="sm" className="mt-3 justify-start px-0">
                  {entry.content}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function DeveloperCenter({ approvedByProfile }: { approvedByProfile: boolean }) {
  const applyForDeveloper = useMutation(api.users.applyForDeveloper);
  const [agents, setAgents] = useState<OwnedAgentDto[]>([]);
  const [isApproved, setIsApproved] = useState(approvedByProfile);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [working, setWorking] = useState(false);

  async function reloadAgents() {
    try {
      const result = await aiDirectPaidHiringApi.listOwnedAgents();
      setAgents(result.items);
      if (result.items.length > 0) setIsApproved(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reloadAgents();
  }, []);

  async function apply() {
    setWorking(true);
    try {
      await applyForDeveloper({});
      setIsApproved(true);
    } finally {
      setWorking(false);
    }
  }

  async function createAgent() {
    if (!name.trim()) return;
    setWorking(true);
    try {
      await aiDirectPaidHiringApi.createAgent({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      setName("");
      setDescription("");
      await reloadAgents();
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="mb-6" aria-labelledby="developer-center-title">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle id="developer-center-title" className="flex items-center gap-2">
              <UserCheck className="h-5 w-5" aria-hidden="true" /> 开发者中心
            </CardTitle>
            <CardDescription>
              {isApproved ? "管理、创建并发布你的 AI 员工。" : "申请成为开发者后即可创建 AI 员工。"}
            </CardDescription>
          </div>
          {!isApproved ? (
            <Button variant="primary" disabled={working} onClick={() => void apply()}>
              申请成为开发者
            </Button>
          ) : null}
        </CardHeader>
        {isApproved ? (
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="AI 员工名称"
              />
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="一句话介绍（可选）"
              />
              <Button disabled={working || !name.trim()} onClick={() => void createAgent()}>
                <Plus className="h-4 w-4" aria-hidden="true" /> 创建 AI 员工
              </Button>
            </div>
            <div>
              <h3 className="mb-3 font-semibold">AI 员工列表</h3>
              {loading ? (
                <p className="text-sm text-muted-foreground">正在加载…</p>
              ) : agents.length ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {agents.map((agent) => (
                    <div key={agent.id} className="rounded-lg border p-4">
                      <div className="flex items-center gap-2 font-semibold">
                        <Bot className="h-4 w-4" />
                        {agent.name}
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                        {agent.description ?? "暂无介绍"}
                      </p>
                      <p className="mt-3 text-xs text-muted-foreground">状态：{agent.status}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  还没有 AI 员工，请从上方创建第一个。
                </p>
              )}
            </div>
          </CardContent>
        ) : null}
      </Card>
    </section>
  );
}

function SkillRow({ skill, ownerHandle }: { skill: DashboardSkill; ownerHandle: string }) {
  const status = skillArtifactStatus(skill);
  const titleId = `dashboard-skill-title-${skill._id}`;
  const detailHref =
    skill.detailHref ??
    buildSkillHref(ownerHandle, skill.ownerPublisherId ?? skill.ownerUserId ?? null, skill.slug);
  const settingsHref = skill.settingsHref ?? `${detailHref}/settings`;
  const stats = [
    { label: "Downloads", value: formatCompactNumber(skill.stats?.downloads ?? 0) },
    { label: "Current version", value: formatVersion(skill.latestVersion?.version) },
    { label: "Last updated", value: formatShortDate(skill.updatedAt) },
  ];

  return (
    <ArtifactCard
      href={detailHref}
      title={skill.displayName}
      titleId={titleId}
      icon={<Box className="h-5 w-5" />}
      status={status}
      stats={stats}
      actions={
        <SettingsLink href={settingsHref} label={`Open settings for ${skill.displayName}`} />
      }
    />
  );
}

function PackageRow({ pkg }: { pkg: DashboardPackage }) {
  const status = packageArtifactStatus(pkg);
  const detailHref = buildPluginDetailHref(pkg.name);
  const validationCount = pkg.inspectorWarningCount ?? 0;
  const titleId = `dashboard-package-title-${pkg._id}`;
  const stats = [
    { label: "Downloads", value: formatCompactNumber(pkg.stats.downloads ?? 0) },
    { label: "Current version", value: formatVersion(pkg.latestVersion) },
    { label: "Last updated", value: formatShortDate(pkg.updatedAt) },
  ];

  return (
    <ArtifactCard
      href={detailHref}
      title={pkg.displayName}
      titleId={titleId}
      icon={<Package className="h-5 w-5" />}
      status={status}
      stats={stats}
      actions={
        validationCount > 0 ? (
          <div className="dashboard-row-action">
            <Button asChild variant="ghost" size="sm">
              <a
                href={buildPluginValidationHref(pkg.name)}
                aria-label={`View ${validationCount} validation findings for ${pkg.displayName}`}
                title="Validation"
              >
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                {validationCount}
              </a>
            </Button>
          </div>
        ) : null
      }
    />
  );
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

function formatShortDate(timestamp: number | undefined) {
  if (!timestamp) return "Unknown";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(
    new Date(timestamp),
  );
}

function formatVersion(version: string | null | undefined) {
  return version ? `v${version}` : "Unknown";
}

function SettingsLink({ href, label }: { href: string; label: string }) {
  return (
    <div className="dashboard-row-action">
      <Button asChild variant="ghost" size="icon-sm">
        <a href={href} aria-label={label} title="Settings">
          <Settings className="h-4 w-4" aria-hidden="true" />
        </a>
      </Button>
    </div>
  );
}
