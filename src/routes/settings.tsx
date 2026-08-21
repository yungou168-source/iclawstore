import { Link, createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Building2,
  CircleX,
  Code,
  Copy,
  GitBranch,
  KeyRound,
  ImageUp,
  Monitor,
  Moon,
  Package,
  Palette,
  Plus,
  Save,
  ShieldAlert,
  Sun,
  Trash2,
  type LucideIcon,
  UserRound,
  Users,
} from "lucide-react";
import {
  type ComponentProps,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { EmptyState } from "../components/EmptyState";
import { copyText } from "../components/InstallCopyButton";
import { MarketplaceIcon } from "../components/MarketplaceIcon";
import { SignInPrompt } from "../components/SignInPrompt";
import { SettingsSkeleton } from "../components/skeletons/ProtectedPageSkeletons";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Separator } from "../components/ui/separator";
import { Textarea } from "../components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { getUserFacingConvexError } from "../lib/convexError";
import { useLocale } from "../lib/i18n/context";
import type { TranslationKey } from "../lib/i18n/translations";
import { useThemeMode } from "../lib/theme";
import { uploadFile } from "../lib/uploadUtils";
import { useAuthStatus } from "../lib/useAuthStatus";

const settingsViews = ["account", "organizations", "githubSources", "tokens", "danger"] as const;
type SettingsView = (typeof settingsViews)[number];

function isSettingsView(value: unknown): value is SettingsView {
  return typeof value === "string" && settingsViews.includes(value as SettingsView);
}

export const Route = createFileRoute("/settings")({
  validateSearch: (search: Record<string, unknown>): { view?: SettingsView } => ({
    view: isSettingsView(search.view) ? search.view : undefined,
  }),
  component: Settings,
});

type ApiToken = {
  _id: Id<"apiTokens">;
  label: string;
  prefix: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
};

type PublisherMembership = {
  publisher: {
    _id: Id<"publishers">;
    handle: string;
    displayName: string;
    kind: "user" | "org";
    image?: string | null;
    bio?: string | null;
    official?: boolean;
    stats?: {
      skills: number;
      packages: number;
      installs: number;
      downloads: number;
      stars: number;
    };
    publishedItems?: Array<{
      kind: "skill" | "plugin";
      displayName: string;
      downloads: number;
    }>;
  };
  role: "owner" | "admin" | "publisher";
};

type OrgMembersResult = {
  publisher: { _id: Id<"publishers">; handle: string } | null;
  members: Array<{
    role: "owner" | "admin" | "publisher";
    user: {
      _id: Id<"users">;
      handle: string | null;
      displayName: string | null;
      image: string | null;
    };
  }>;
};

type GitHubSkillSource = {
  _id: Id<"githubSkillSources">;
  repo: string;
  ownerPublisher?: {
    _id: Id<"publishers">;
    handle: string;
    displayName: string;
  } | null;
  defaultBranch?: string;
  lastSyncStatus?: "ok" | "failed" | "skipped";
  lastSyncError?: string;
  lastSyncErrorAt?: number;
  displayManifestStatus?: "ok" | "missing" | "invalid" | "failed";
  displayManifestFetchedAt?: number;
  displayManifestCommit?: string;
  lastSyncIssues?: Array<{
    slug: string;
    path: string;
    displayName: string;
    kind: "invalid_slug" | "slug_conflict";
    severity: "error" | "warning";
    message: string;
    existingOwnerHandle?: string;
  }>;
  lastSyncInvalidSkills?: Array<{
    slug: string;
    path: string;
    displayName: string;
    error: string;
  }>;
  skills: Array<{
    _id: Id<"skills">;
    slug: string;
    displayName: string;
    githubPath?: string;
    githubCurrentStatus?: "present" | "missing" | "unknown";
  }>;
  createdAt: number;
  updatedAt: number;
};

const navigationGroups: Array<{
  items: Array<{
    view: SettingsView;
    labelKey: TranslationKey;
    mobileLabelKey: TranslationKey;
    icon: LucideIcon;
  }>;
}> = [
  {
    items: [
      {
        view: "account",
        labelKey: "settings.account_preferences",
        mobileLabelKey: "settings.account_mobile",
        icon: UserRound,
      },
    ],
  },
  {
    items: [
      {
        view: "organizations",
        labelKey: "settings.organizations",
        mobileLabelKey: "settings.organizations_mobile",
        icon: Building2,
      },
      {
        view: "githubSources",
        labelKey: "settings.github_sources",
        mobileLabelKey: "settings.github_sources_mobile",
        icon: GitBranch,
      },
      {
        view: "tokens",
        labelKey: "settings.tokens",
        mobileLabelKey: "settings.tokens_mobile",
        icon: KeyRound,
      },
      {
        view: "danger",
        labelKey: "settings.danger",
        mobileLabelKey: "settings.danger_mobile",
        icon: ShieldAlert,
      },
    ],
  },
];

const settingsStickyTop = "calc(128px + var(--space-4))";
const settingsScrollMargin = "calc(128px + var(--space-5))";
const publishedSkillBadgeVariant = ["com", "pact"].join("") as ComponentProps<
  typeof Badge
>["variant"];
const themeToggleItemClass =
  "!h-20 min-w-0 flex-1 flex-col gap-2 !rounded-[var(--r-btn)] border border-[color:var(--line)] bg-[color:var(--surface)] px-3 text-sm font-semibold text-[color:var(--ink-soft)] opacity-70 hover:border-[color:var(--border-ui-hover)] hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--ink)] hover:opacity-100 data-[state=on]:border-[color:var(--accent)] data-[state=on]:!bg-[color:var(--surface-muted)] data-[state=on]:text-[color:var(--ink)] data-[state=on]:opacity-100 sm:!w-28 sm:flex-none";

export function Settings() {
  const { t } = useLocale();
  const { isAuthenticated, isLoading: isAuthLoading, me } = useAuthStatus();
  const updateProfile = useMutation(api.users.updateProfile);
  const updateAvatar = useMutation(api.users.updateAvatar);
  const generateUploadUrl = useMutation(api.uploads.generateUploadUrl);
  const deleteAccount = useMutation(api.users.deleteAccount);
  const { mode: themeMode, setMode: setThemeMode } = useThemeMode();
  const tokens = useQuery(api.tokens.listMine, me ? {} : "skip") as Array<ApiToken> | undefined;
  const createToken = useMutation(api.tokens.create);
  const revokeToken = useMutation(api.tokens.revoke);
  const publisherMemberships = useQuery(api.publishers.listMine, me ? {} : "skip") as
    | Array<PublisherMembership>
    | undefined;
  const createOrg = useMutation(api.publishers.createOrg);
  const deleteOrg = useMutation(api.publishers.deleteOrg);
  const updateOrgProfile = useMutation(api.publishers.updateProfile);
  const updateOrgAvatar = useMutation(api.publishers.updateAvatar);
  const addOrgMember = useMutation(api.publishers.addMember);
  const removeOrgMember = useMutation(api.publishers.removeMember);
  const configureGitHubSource = useAction(api.githubSkillSync.configurePublicGitHubSkillSource);
  const deleteGitHubSource = useMutation(api.githubSkillSources.deleteForPublisher);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [profileSlug, setProfileSlug] = useState("");
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [tokenLabel, setTokenLabel] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [orgHandle, setOrgHandle] = useState("");
  const [orgDisplayName, setOrgDisplayName] = useState("");
  const [createOrgError, setCreateOrgError] = useState<string | null>(null);
  const [isCreatingOrg, setIsCreatingOrg] = useState(false);
  const [selectedOrgHandle, setSelectedOrgHandle] = useState("");
  const [selectedOrgDisplayName, setSelectedOrgDisplayName] = useState("");
  const [selectedOrgBio, setSelectedOrgBio] = useState("");
  const [selectedOrgImage, setSelectedOrgImage] = useState("");
  const [memberHandle, setMemberHandle] = useState("");
  const [memberRole, setMemberRole] = useState<"owner" | "admin" | "publisher">("publisher");
  const [selectedSourcePublisherId, setSelectedSourcePublisherId] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [isSyncingSource, setIsSyncingSource] = useState(false);
  const [deletingSourceId, setDeletingSourceId] = useState<Id<"githubSkillSources"> | null>(null);
  const [sourceToDelete, setSourceToDelete] = useState<GitHubSkillSource | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteOrgDialogOpen, setDeleteOrgDialogOpen] = useState(false);
  const [createOrgDialogOpen, setCreateOrgDialogOpen] = useState(false);
  const [addMemberDialogOpen, setAddMemberDialogOpen] = useState(false);
  const [revokeTokenId, setRevokeTokenId] = useState<Id<"apiTokens"> | null>(null);
  const { activeView, navigateToView } = useActiveSettingsView();
  const orgs = (publisherMemberships ?? []).filter((entry) => entry.publisher.kind === "org");
  const manageablePublishers = (publisherMemberships ?? []).filter(
    (entry) => entry.role !== "publisher",
  );
  const officialGitHubSourcePublishers = manageablePublishers.filter(
    (entry) => entry.publisher.official === true,
  );
  const publisherMembershipsLoaded = publisherMemberships !== undefined;
  const canConfigureGitHubSources = officialGitHubSourcePublishers.length > 0;
  const effectiveActiveView =
    activeView === "githubSources" && publisherMembershipsLoaded && !canConfigureGitHubSources
      ? "account"
      : activeView;
  const selectedSourcePublisher =
    officialGitHubSourcePublishers.find(
      (entry) => entry.publisher._id === selectedSourcePublisherId,
    ) ??
    officialGitHubSourcePublishers[0] ??
    null;
  const selectedOrg =
    orgs.find((entry) => entry.publisher.handle === selectedOrgHandle) ?? orgs[0] ?? null;
  const hasOrgProfileChanges = selectedOrg
    ? selectedOrgDisplayName !== (selectedOrg.publisher.displayName ?? "") ||
      selectedOrgBio !== (selectedOrg.publisher.bio ?? "") ||
      selectedOrgImage !== (selectedOrg.publisher.image ?? "")
    : false;
  const hasProfileChanges = me
    ? displayName !== (me.displayName ?? "") ||
      bio !== (me.bio ?? "") ||
      profileSlug !== (me.profileSlug ?? me.handle ?? "")
    : false;
  const activeTokens = (tokens ?? []).filter((token) => !token.revokedAt);
  const revokedTokens = (tokens ?? []).filter((token) => token.revokedAt);
  const orgMembers = useQuery(
    api.publishers.listMembers,
    activeView === "organizations" && selectedOrg && selectedOrg.role !== "publisher"
      ? { publisherHandle: selectedOrg.publisher.handle }
      : "skip",
  ) as OrgMembersResult | null | undefined;
  const githubSources = useQuery(
    api.githubSkillSources.listForManageableOfficialPublishers,
    effectiveActiveView === "githubSources" && canConfigureGitHubSources ? {} : "skip",
  ) as GitHubSkillSource[] | undefined;
  const deletionPublishers = (publisherMemberships ?? []).filter(
    (entry) => entry.publisher.kind === "user" || entry.role === "owner",
  );

  useEffect(() => {
    if (!me) return;
    setDisplayName(me.displayName ?? "");
    setBio(me.bio ?? "");
    setProfileSlug(me.profileSlug ?? me.handle ?? "");
  }, [me]);

  useEffect(() => {
    if (selectedOrgHandle) return;
    if (orgs[0]?.publisher.handle) {
      setSelectedOrgHandle(orgs[0].publisher.handle);
    }
  }, [orgs, selectedOrgHandle]);

  useEffect(() => {
    if (!officialGitHubSourcePublishers.length) {
      setSelectedSourcePublisherId("");
      return;
    }
    if (
      selectedSourcePublisherId &&
      officialGitHubSourcePublishers.some(
        (entry) => entry.publisher._id === selectedSourcePublisherId,
      )
    ) {
      return;
    }
    setSelectedSourcePublisherId(officialGitHubSourcePublishers[0]?.publisher._id ?? "");
  }, [officialGitHubSourcePublishers, selectedSourcePublisherId]);

  useEffect(() => {
    if (!selectedOrg) {
      setSelectedOrgDisplayName("");
      setSelectedOrgBio("");
      setSelectedOrgImage("");
      return;
    }
    setSelectedOrgDisplayName(selectedOrg.publisher.displayName ?? "");
    setSelectedOrgBio(selectedOrg.publisher.bio ?? "");
    setSelectedOrgImage(selectedOrg.publisher.image ?? "");
  }, [selectedOrg]);

  if (isAuthLoading) {
    return <SettingsSkeleton />;
  }

  if (!isAuthenticated || !me) {
    return (
      <SignInPrompt
        title={t("settings.sign_in_title")}
        description={t("settings.sign_in_description")}
      />
    );
  }

  const activeSectionLoading =
    (activeView === "organizations" &&
      (publisherMemberships === undefined ||
        (selectedOrg && selectedOrg.role !== "publisher" && orgMembers === undefined))) ||
    (activeView === "tokens" && tokens === undefined);

  if (activeSectionLoading) {
    return <SettingsSkeleton />;
  }

  const accountAvatar = me.image ?? undefined;
  const accountInitial = (displayName || me.displayName || me.name || me.handle || "U")
    .charAt(0)
    .toUpperCase();

  async function onSave(event: FormEvent) {
    event.preventDefault();
    await updateProfile({ displayName, bio, profileSlug });
    toast.success(t("settings.saved"));
  }

  async function onUploadAvatar(file: File, publisherId?: Id<"publishers">) {
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      toast.error("请选择小于 5 MB 的图片文件");
      return;
    }
    setIsUploadingAvatar(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const storageId = (await uploadFile(uploadUrl, file)) as Id<"_storage">;
      if (publisherId) {
        const result = await updateOrgAvatar({ publisherId, storageId });
        setSelectedOrgImage(result.image);
      } else {
        await updateAvatar({ storageId });
      }
      toast.success("头像已更新");
    } catch (error) {
      toast.error(getUserFacingConvexError(error, "头像上传失败"));
    } finally {
      setIsUploadingAvatar(false);
    }
  }

  async function onDelete() {
    setDeleteDialogOpen(false);
    await deleteAccount();
  }

  async function onCreateToken() {
    const label = tokenLabel.trim() || t("settings.default_token_label");
    const result = await createToken({ label });
    setNewToken(result.token);
    setTokenLabel("");
  }

  async function onCreateOrg() {
    setCreateOrgError(null);
    setIsCreatingOrg(true);
    try {
      const result = await createOrg({
        handle: orgHandle.trim(),
        displayName: orgDisplayName.trim() || orgHandle.trim(),
        bio: undefined,
      });
      if (result?.publisher?.handle) {
        setSelectedOrgHandle(result.publisher.handle);
        setOrgHandle("");
        setOrgDisplayName("");
        setCreateOrgDialogOpen(false);
        toast.success(t("settings.org_created"));
      }
    } catch (error) {
      const message = getUserFacingConvexError(error, t("settings.org_create_error"));
      setCreateOrgError(message);
      toast.error(message);
    } finally {
      setIsCreatingOrg(false);
    }
  }

  async function onSaveOrgProfile() {
    if (!selectedOrg) return;
    await updateOrgProfile({
      publisherId: selectedOrg.publisher._id,
      displayName: selectedOrgDisplayName,
      bio: selectedOrgBio || undefined,
      image: selectedOrgImage || undefined,
    });
    toast.success(t("settings.org_updated"));
  }

  async function onDeleteOrg() {
    if (!selectedOrg) return;
    const deletingHandle = selectedOrg.publisher.handle;
    await deleteOrg({ publisherId: selectedOrg.publisher._id });
    setDeleteOrgDialogOpen(false);
    const nextOrg = orgs.find((entry) => entry.publisher.handle !== deletingHandle);
    setSelectedOrgHandle(nextOrg?.publisher.handle ?? "");
    toast.success(t("settings.org_deleted", { handle: deletingHandle }));
  }

  async function onConfigureGitHubSource(event: FormEvent) {
    event.preventDefault();
    if (!selectedSourcePublisher) return;
    const repo = parseGitHubRepoInput(githubRepo);
    if (!repo) return;
    setIsSyncingSource(true);
    try {
      const result = await configureGitHubSource({
        ownerPublisherId: selectedSourcePublisher.publisher._id,
        repo,
      });
      setGithubRepo("");
      toast.success(formatGitHubSourceSyncToast(result?.stats));
    } catch (error) {
      toast.error(getUserFacingConvexError(error, t("settings.github_sync_error")));
    } finally {
      setIsSyncingSource(false);
    }
  }

  async function onDeleteGitHubSource(source: GitHubSkillSource) {
    const ownerPublisherId = source.ownerPublisher?._id ?? selectedSourcePublisher?.publisher._id;
    if (!ownerPublisherId) return;
    setDeletingSourceId(source._id);
    try {
      const result = await deleteGitHubSource({
        ownerPublisherId,
        sourceId: source._id,
      });
      toast.success(t("settings.github_sync_deleted", { count: result.deletedSkills }));
      setSourceToDelete(null);
    } catch (error) {
      toast.error(getUserFacingConvexError(error, t("settings.github_delete_error")));
    } finally {
      setDeletingSourceId(null);
    }
  }

  return (
    <main className="border-b border-[color:var(--line)] bg-[color:var(--bg)]">
      <div
        className="mx-auto flex w-full flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10 lg:px-6"
        style={
          {
            maxWidth: "var(--page-max)",
            "--settings-sticky-top": settingsStickyTop,
            "--settings-scroll-margin": settingsScrollMargin,
          } as CSSProperties
        }
      >
        <header>
          <h1 className="font-display text-3xl font-black leading-none text-[color:var(--ink)]">
            {t("settings.title")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--ink-soft)]">
            {t("settings.subtitle")}
          </p>
        </header>
        <Separator />

        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <aside className="lg:sticky lg:top-[var(--settings-sticky-top)] lg:w-[272px] lg:shrink-0">
            <div className="flex flex-col">
              <nav
                className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0"
                aria-label={t("settings.sections_label")}
              >
                {navigationGroups.map((group, groupIndex) => (
                  <div
                    key={`settings-nav-group-${groupIndex}`}
                    className="contents lg:flex lg:shrink lg:flex-col lg:gap-1"
                  >
                    {group.items.map((item) => {
                      if (
                        item.view === "githubSources" &&
                        publisherMembershipsLoaded &&
                        !canConfigureGitHubSources
                      ) {
                        return null;
                      }
                      const active = effectiveActiveView === item.view;
                      return (
                        <button
                          key={item.view}
                          type="button"
                          onClick={() => navigateToView(item.view)}
                          aria-current={active ? "true" : undefined}
                          aria-label={t(item.labelKey)}
                          className={`settings-sidebar-link inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] px-3 py-2 text-left text-sm font-semibold no-underline transition-colors hover:no-underline lg:min-h-10 lg:px-2 ${
                            active
                              ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[color:var(--ink)]"
                              : "text-[color:var(--ink-soft)] hover:bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] hover:text-[color:var(--ink)]"
                          }`}
                        >
                          <item.icon
                            size={16}
                            className={
                              active
                                ? "text-[color:var(--ink)] opacity-75"
                                : "text-[color:var(--ink-soft)] opacity-60"
                            }
                          />
                          <span className="lg:hidden">{t(item.mobileLabelKey)}</span>
                          <span className="hidden lg:inline">{t(item.labelKey)}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </nav>
            </div>
          </aside>

          <div className="flex min-w-0 flex-col lg:flex-1">
            <SettingsSection
              id="account"
              visible={effectiveActiveView === "account"}
              icon={<UserRound size={18} />}
              title={t("settings.account_preferences")}
              description={t("settings.account_description")}
            >
              <div className="flex flex-col gap-5">
                <SettingsBlock>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)]">
                        <UserRound size={17} />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-[color:var(--ink)]">
                          {t("settings.account")}
                        </h3>
                        <p className="text-sm text-[color:var(--ink-soft)]">
                          {t("settings.account_profile_description")}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Avatar className="hidden h-14 w-14 rounded-full sm:flex" title="用户头像">
                        {accountAvatar ? <AvatarImage src={accountAvatar} alt="用户头像" /> : null}
                        <AvatarFallback>{accountInitial}</AvatarFallback>
                      </Avatar>
                      <Button asChild type="button" variant="outline" size="sm">
                        <label className="cursor-pointer">
                          <ImageUp size={15} />
                          {isUploadingAvatar ? "上传中…" : "上传头像"}
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            className="sr-only"
                            disabled={isUploadingAvatar}
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) void onUploadAvatar(file);
                              event.target.value = "";
                            }}
                          />
                        </label>
                      </Button>
                    </div>
                  </div>

                  <form className="flex min-w-0 flex-col gap-4" onSubmit={onSave}>
                    <Field label={t("settings.display_name")} htmlFor="settings-display-name">
                      <Input
                        id="settings-display-name"
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                      />
                    </Field>
                    <Field label="用户介绍页地址" htmlFor="settings-profile-slug">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-[color:var(--ink-soft)]">/profile/</span>
                        <Input
                          id="settings-profile-slug"
                          value={profileSlug}
                          onChange={(event) => setProfileSlug(event.target.value.toLowerCase())}
                          placeholder="your-profile"
                        />
                        {profileSlug ? (
                          <Button asChild type="button" variant="outline" size="sm">
                            <Link to="/profile/$slug" params={{ slug: profileSlug }}>
                              查看
                            </Link>
                          </Button>
                        ) : null}
                      </div>
                    </Field>
                    <Field label={t("settings.bio")} htmlFor="settings-bio">
                      <Textarea
                        id="settings-bio"
                        rows={5}
                        value={bio}
                        onChange={(event) => setBio(event.target.value)}
                        placeholder={t("settings.bio_placeholder")}
                      />
                    </Field>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                      {hasProfileChanges ? (
                        <span className="text-sm font-semibold text-red-700 dark:text-red-300">
                          {t("settings.unsaved_changes")}
                        </span>
                      ) : null}
                      <Button variant="primary" type="submit">
                        <Save size={16} />
                        {t("settings.save_profile")}
                      </Button>
                    </div>
                  </form>
                </SettingsBlock>

                <SettingsBlock>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)]">
                        <Palette size={17} />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-[color:var(--ink)]">
                          {t("settings.appearance")}
                        </h3>
                        <p className="text-sm text-[color:var(--ink-soft)]">
                          {t("settings.appearance_description")}
                        </p>
                      </div>
                    </div>

                    <ToggleGroup
                      type="single"
                      value={themeMode}
                      onValueChange={(value) => {
                        if (!value) return;
                        setThemeMode(value as "system" | "light" | "dark");
                      }}
                      aria-label={t("settings.theme_mode")}
                      className="!h-auto w-full justify-start gap-2 !border-0 !bg-transparent !p-0 sm:w-auto lg:justify-end"
                    >
                      <ToggleGroupItem
                        value="system"
                        aria-label={t("settings.theme_system")}
                        className={themeToggleItemClass}
                      >
                        <Monitor size={18} />
                        {t("settings.theme_system")}
                      </ToggleGroupItem>
                      <ToggleGroupItem
                        value="light"
                        aria-label={t("settings.theme_light")}
                        className={themeToggleItemClass}
                      >
                        <Sun size={18} />
                        {t("settings.theme_light")}
                      </ToggleGroupItem>
                      <ToggleGroupItem
                        value="dark"
                        aria-label={t("settings.theme_dark")}
                        className={themeToggleItemClass}
                      >
                        <Moon size={18} />
                        {t("settings.theme_dark")}
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                </SettingsBlock>
              </div>
            </SettingsSection>

            <SettingsSection
              id="organizations"
              visible={effectiveActiveView === "organizations"}
              icon={<Building2 size={18} />}
              title={t("settings.organizations")}
              description={t("settings.organizations_description")}
            >
              <div className="flex flex-col gap-5">
                {orgs.length > 0 ? (
                  <>
                    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <Select
                        value={selectedOrg?.publisher.handle ?? ""}
                        onValueChange={setSelectedOrgHandle}
                      >
                        <SelectTrigger
                          id="settings-manage-org"
                          aria-label={t("settings.manage_org")}
                          className="h-12 sm:min-w-[280px]"
                        >
                          {selectedOrg ? (
                            <span className="flex min-w-0 items-center gap-2">
                              <OrgLogoSmall
                                image={selectedOrg.publisher.image}
                                name={selectedOrg.publisher.displayName}
                                handle={selectedOrg.publisher.handle}
                                className="h-6 w-6"
                              />
                              <span className="truncate">
                                @{selectedOrg.publisher.handle} ·{" "}
                                {t(`settings.role.${selectedOrg.role}`)}
                              </span>
                            </span>
                          ) : (
                            <SelectValue placeholder={t("settings.select_org")} />
                          )}
                        </SelectTrigger>
                        <SelectContent>
                          {orgs.map((entry) => (
                            <SelectItem key={entry.publisher._id} value={entry.publisher.handle}>
                              <span className="flex min-w-0 items-center gap-2">
                                <OrgLogoSmall
                                  image={entry.publisher.image}
                                  name={entry.publisher.displayName}
                                  handle={entry.publisher.handle}
                                  className="h-6 w-6"
                                />
                                <span className="truncate">
                                  @{entry.publisher.handle} · {t(`settings.role.${entry.role}`)}
                                </span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Dialog
                        open={createOrgDialogOpen}
                        onOpenChange={(open) => {
                          setCreateOrgDialogOpen(open);
                          if (open) setCreateOrgError(null);
                        }}
                      >
                        <DialogTrigger asChild>
                          <Button variant="outline" type="button" className="h-12 sm:w-auto">
                            <Plus size={16} />
                            {t("settings.add_new_org")}
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>{t("settings.create_org")}</DialogTitle>
                            <DialogDescription>
                              {t("settings.create_org_description")}
                            </DialogDescription>
                          </DialogHeader>
                          <div className="grid gap-4">
                            <Field label="公司名（英文）" htmlFor="settings-org-handle">
                              <Input
                                id="settings-org-handle"
                                value={orgHandle}
                                onChange={(event) => {
                                  setOrgHandle(event.target.value);
                                  setCreateOrgError(null);
                                }}
                                placeholder="请输入公司英文名"
                              />
                            </Field>
                            <Field label="公司名（中文）" htmlFor="settings-org-display-name">
                              <Input
                                id="settings-org-display-name"
                                value={orgDisplayName}
                                onChange={(event) => {
                                  setOrgDisplayName(event.target.value);
                                  setCreateOrgError(null);
                                }}
                                placeholder="请输入公司中文名"
                              />
                            </Field>
                          </div>
                          {createOrgError ? (
                            <p
                              className="text-sm font-medium text-red-600 dark:text-red-400"
                              role="alert"
                            >
                              {createOrgError}
                            </p>
                          ) : null}
                          <DialogFooter>
                            <Button variant="ghost" onClick={() => setCreateOrgDialogOpen(false)}>
                              {t("common.cancel")}
                            </Button>
                            <Button
                              variant="primary"
                              type="button"
                              disabled={!orgHandle.trim() || isCreatingOrg}
                              onClick={() => void onCreateOrg()}
                            >
                              <Building2 size={16} />
                              {isCreatingOrg
                                ? t("settings.creating_org")
                                : t("settings.create_org")}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>

                    {selectedOrg && selectedOrg.role !== "publisher" ? (
                      <>
                        <SettingsBlock>
                          <div className="flex min-w-0 w-full flex-col gap-5">
                            <div className="flex min-w-0 items-center gap-4">
                              <OrgLogo
                                image={selectedOrgImage.trim() || undefined}
                                name={selectedOrgDisplayName}
                                handle={selectedOrg.publisher.handle}
                                className="h-16 w-16"
                              />
                              <div className="min-w-0">
                                <h3 className="truncate text-base font-bold text-[color:var(--ink)]">
                                  {selectedOrgDisplayName || selectedOrg.publisher.handle}
                                </h3>
                                <p className="truncate text-sm text-[color:var(--ink-soft)]">
                                  @{selectedOrg.publisher.handle}
                                </p>
                              </div>
                            </div>

                            <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-2">
                              <Field
                                label={t("settings.display_name")}
                                htmlFor="settings-selected-org-display-name"
                              >
                                <Input
                                  id="settings-selected-org-display-name"
                                  value={selectedOrgDisplayName}
                                  onChange={(event) =>
                                    setSelectedOrgDisplayName(event.target.value)
                                  }
                                  placeholder="请输入公司中文名"
                                />
                              </Field>
                              <div className="flex min-w-0 items-end gap-2">
                                <div className="min-w-0 flex-1">
                                  <Field label="公司头像" htmlFor="settings-selected-org-image">
                                    <Button
                                      asChild
                                      type="button"
                                      variant="outline"
                                      className="w-full"
                                    >
                                      <label className="cursor-pointer">
                                        <ImageUp size={15} />
                                        {isUploadingAvatar ? "上传中…" : "从本地上传图片"}
                                        <input
                                          id="settings-selected-org-image"
                                          type="file"
                                          accept="image/png,image/jpeg,image/webp,image/gif"
                                          className="sr-only"
                                          disabled={isUploadingAvatar}
                                          onChange={(event) => {
                                            const file = event.target.files?.[0];
                                            if (file)
                                              void onUploadAvatar(file, selectedOrg.publisher._id);
                                            event.target.value = "";
                                          }}
                                        />
                                      </label>
                                    </Button>
                                  </Field>
                                </div>
                              </div>
                              <div className="lg:col-span-2">
                                <Field
                                  label={t("settings.bio")}
                                  htmlFor="settings-selected-org-bio"
                                >
                                  <Textarea
                                    id="settings-selected-org-bio"
                                    rows={4}
                                    value={selectedOrgBio}
                                    onChange={(event) => setSelectedOrgBio(event.target.value)}
                                    placeholder={t("settings.org_bio_placeholder")}
                                  />
                                </Field>
                              </div>
                              <div className="flex flex-col gap-3 lg:col-span-2 lg:flex-row lg:items-center lg:justify-end">
                                {hasOrgProfileChanges ? (
                                  <span className="text-sm font-semibold text-red-700 dark:text-red-300">
                                    {t("settings.unsaved_changes")}
                                  </span>
                                ) : null}
                                <Button type="button" onClick={() => void onSaveOrgProfile()}>
                                  <Save size={16} />
                                  {t("settings.save_changes")}
                                </Button>
                              </div>
                            </div>
                          </div>
                        </SettingsBlock>

                        <SettingsBlock>
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)]">
                                <Users size={16} />
                              </span>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <h3 className="text-sm font-bold text-[color:var(--ink)]">
                                    {t("settings.members")}
                                  </h3>
                                  <span className="inline-flex h-5 items-center rounded-full border border-[color:var(--line)] bg-[color:var(--surface-muted)] px-2 text-[11px] font-semibold text-[color:var(--ink-soft)]">
                                    {(orgMembers?.members ?? []).length}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <Dialog
                              open={addMemberDialogOpen}
                              onOpenChange={setAddMemberDialogOpen}
                            >
                              <DialogTrigger asChild>
                                <Button
                                  type="button"
                                  className="h-10 w-auto shrink-0 px-3 text-sm sm:h-11 sm:px-4"
                                >
                                  <Users size={16} />
                                  {t("settings.add_member")}
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>{t("settings.add_member")}</DialogTitle>
                                  <DialogDescription>
                                    {t("settings.add_member_description", {
                                      handle: selectedOrg.publisher.handle,
                                    })}
                                  </DialogDescription>
                                </DialogHeader>
                                <div className="grid gap-4">
                                  <Field
                                    label={t("settings.user_handle")}
                                    htmlFor="settings-add-member"
                                  >
                                    <Input
                                      id="settings-add-member"
                                      value={memberHandle}
                                      onChange={(event) => setMemberHandle(event.target.value)}
                                      placeholder="@username"
                                    />
                                  </Field>
                                  <Field label={t("settings.role")} htmlFor="settings-member-role">
                                    <Select
                                      value={memberRole}
                                      onValueChange={(value) =>
                                        setMemberRole(value as "owner" | "admin" | "publisher")
                                      }
                                    >
                                      <SelectTrigger id="settings-member-role">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="publisher">
                                          {t("settings.role.publisher")}
                                        </SelectItem>
                                        <SelectItem value="admin">
                                          {t("settings.role.admin")}
                                        </SelectItem>
                                        <SelectItem value="owner">
                                          {t("settings.role.owner")}
                                        </SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </Field>
                                </div>
                                <DialogFooter>
                                  <Button
                                    variant="ghost"
                                    onClick={() => setAddMemberDialogOpen(false)}
                                  >
                                    {t("common.cancel")}
                                  </Button>
                                  <Button
                                    type="button"
                                    disabled={!memberHandle.trim()}
                                    onClick={() =>
                                      void addOrgMember({
                                        publisherId: selectedOrg.publisher._id,
                                        userHandle: memberHandle,
                                        role: memberRole,
                                      }).then(() => {
                                        setMemberHandle("");
                                        setAddMemberDialogOpen(false);
                                      })
                                    }
                                  >
                                    <Users size={16} />
                                    {t("settings.add_member")}
                                  </Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>
                          </div>

                          <div className="flex min-w-0 flex-col gap-4">
                            {(orgMembers?.members ?? []).length ? (
                              <div className="divide-y divide-[color:var(--line)] overflow-hidden">
                                {orgMembers?.members.map((entry) => (
                                  <div
                                    key={`${entry.user._id}:${entry.role}`}
                                    className="flex items-center justify-between gap-3 py-3"
                                  >
                                    <div className="flex min-w-0 items-center gap-3">
                                      <Avatar className="h-9 w-9 rounded-full">
                                        {entry.user.image ? (
                                          <AvatarImage
                                            src={entry.user.image}
                                            alt={
                                              entry.user.displayName ??
                                              entry.user.handle ??
                                              t("settings.user_fallback")
                                            }
                                          />
                                        ) : null}
                                        <AvatarFallback>
                                          {(entry.user.displayName ?? entry.user.handle ?? "U")
                                            .charAt(0)
                                            .toUpperCase()}
                                        </AvatarFallback>
                                      </Avatar>
                                      <div className="flex min-w-0 flex-col gap-1">
                                        <div className="flex min-w-0 items-center gap-2">
                                          <span className="truncate pr-1 text-sm font-semibold text-[color:var(--ink)]">
                                            {entry.user.displayName ??
                                              entry.user.handle ??
                                              entry.user._id}
                                          </span>
                                          <Badge className="shrink-0 self-center px-2.5 py-0.5 text-fs-xs">
                                            {t(`settings.role.${entry.role}`)}
                                          </Badge>
                                        </div>
                                        <div className="truncate text-xs text-[color:var(--ink-soft)]">
                                          @{entry.user.handle ?? "user"}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex shrink-0 items-center">
                                      {entry.role !== "owner" ? (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          type="button"
                                          onClick={() =>
                                            void removeOrgMember({
                                              publisherId: selectedOrg.publisher._id,
                                              userId: entry.user._id,
                                            })
                                          }
                                        >
                                          {t("settings.remove_member")}
                                        </Button>
                                      ) : null}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </SettingsBlock>

                        {selectedOrg.role === "owner" ? (
                          <SettingsBlock tone="danger">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex min-w-0 items-center gap-3">
                                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-red-300/40 bg-red-500/10 text-red-700 dark:border-red-500/30 dark:text-red-300">
                                  <ShieldAlert size={17} />
                                </span>
                                <div className="min-w-0">
                                  <h3 className="text-sm font-bold text-red-700 dark:text-red-300">
                                    {t("settings.delete_org")}
                                  </h3>
                                  <p className="text-sm text-[color:var(--ink-soft)]">
                                    {t("settings.delete_org_description")}
                                  </p>
                                </div>
                              </div>
                              <Dialog
                                open={deleteOrgDialogOpen}
                                onOpenChange={setDeleteOrgDialogOpen}
                              >
                                <DialogTrigger asChild>
                                  <Button variant="destructive" type="button" className="sm:w-auto">
                                    <Trash2 size={16} />
                                    {t("settings.delete_org")}
                                  </Button>
                                </DialogTrigger>
                                <DialogContent>
                                  <DialogHeader>
                                    <DialogTitle>{t("settings.delete_org")}</DialogTitle>
                                    <DialogDescription>
                                      {t("settings.delete_org_confirm", {
                                        handle: selectedOrg.publisher.handle,
                                      })}
                                    </DialogDescription>
                                  </DialogHeader>
                                  <DeletionResourceSummary
                                    publishers={[selectedOrg]}
                                    emptyLabel={t("settings.org_no_resources")}
                                  />
                                  <DialogFooter>
                                    <Button
                                      variant="ghost"
                                      onClick={() => setDeleteOrgDialogOpen(false)}
                                    >
                                      {t("common.cancel")}
                                    </Button>
                                    <Button
                                      variant="destructive"
                                      onClick={() => void onDeleteOrg()}
                                    >
                                      {t("settings.delete_org_permanently")}
                                    </Button>
                                  </DialogFooter>
                                </DialogContent>
                              </Dialog>
                            </div>
                          </SettingsBlock>
                        ) : null}
                      </>
                    ) : selectedOrg ? (
                      <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)]/30 p-4 text-sm text-[color:var(--ink-soft)]">
                        {t("settings.publisher_only_notice")}
                      </div>
                    ) : null}
                  </>
                ) : null}

                {!orgs.length ? (
                  <SettingsBlock>
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)]">
                          <Building2 size={17} />
                        </span>
                        <div className="min-w-0">
                          <h3 className="text-sm font-bold text-[color:var(--ink)]">
                            {t("settings.create_org")}
                          </h3>
                          <p className="text-sm text-[color:var(--ink-soft)]">
                            {t("settings.create_org_description")}
                          </p>
                        </div>
                      </div>
                      <Dialog
                        open={createOrgDialogOpen}
                        onOpenChange={(open) => {
                          setCreateOrgDialogOpen(open);
                          if (open) setCreateOrgError(null);
                        }}
                      >
                        <DialogTrigger asChild>
                          <Button variant="primary" type="button" className="lg:w-auto">
                            <Building2 size={16} />
                            {t("settings.create_org")}
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>{t("settings.create_org")}</DialogTitle>
                            <DialogDescription>
                              {t("settings.create_org_description")}
                            </DialogDescription>
                          </DialogHeader>
                          <div className="grid gap-4">
                            <Field label="公司名（英文）" htmlFor="settings-org-handle-empty">
                              <Input
                                id="settings-org-handle-empty"
                                value={orgHandle}
                                onChange={(event) => {
                                  setOrgHandle(event.target.value);
                                  setCreateOrgError(null);
                                }}
                                placeholder="请输入公司英文名"
                              />
                            </Field>
                            <Field label="公司名（中文）" htmlFor="settings-org-display-name-empty">
                              <Input
                                id="settings-org-display-name-empty"
                                value={orgDisplayName}
                                onChange={(event) => {
                                  setOrgDisplayName(event.target.value);
                                  setCreateOrgError(null);
                                }}
                                placeholder="请输入公司中文名"
                              />
                            </Field>
                          </div>
                          {createOrgError ? (
                            <p
                              className="text-sm font-medium text-red-600 dark:text-red-400"
                              role="alert"
                            >
                              {createOrgError}
                            </p>
                          ) : null}
                          <DialogFooter>
                            <Button variant="ghost" onClick={() => setCreateOrgDialogOpen(false)}>
                              {t("common.cancel")}
                            </Button>
                            <Button
                              variant="primary"
                              type="button"
                              disabled={!orgHandle.trim() || isCreatingOrg}
                              onClick={() => void onCreateOrg()}
                            >
                              <Building2 size={16} />
                              {isCreatingOrg
                                ? t("settings.creating_org")
                                : t("settings.create_org")}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </SettingsBlock>
                ) : null}
              </div>
            </SettingsSection>

            <SettingsSection
              id="githubSources"
              visible={effectiveActiveView === "githubSources"}
              icon={<GitBranch size={18} />}
              title={t("settings.github_sources")}
              description={t("settings.github_sources_description")}
            >
              <div className="flex flex-col gap-5">
                <SettingsBlock>
                  <div className="flex flex-col gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)]">
                        <GitBranch size={17} />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-[color:var(--ink)]">
                          {t("settings.github_sync_title")}
                        </h3>
                        <p className="text-sm text-[color:var(--ink-soft)]">
                          {t("settings.github_sync_description")}
                        </p>
                      </div>
                    </div>

                    {selectedSourcePublisher ? (
                      <GitHubSourceForm
                        publisherOptions={officialGitHubSourcePublishers}
                        selectedPublisherId={selectedSourcePublisher.publisher._id}
                        onPublisherChange={setSelectedSourcePublisherId}
                        githubRepo={githubRepo}
                        onGithubRepoChange={setGithubRepo}
                        onConfigure={onConfigureGitHubSource}
                        isSyncing={isSyncingSource}
                      />
                    ) : (
                      <p className="rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)]/25 p-3 text-sm text-[color:var(--ink-soft)]">
                        {t("settings.github_official_required")}
                      </p>
                    )}
                  </div>
                </SettingsBlock>

                <GitHubSourceList
                  sources={githubSources}
                  deletingSourceId={deletingSourceId}
                  onDeleteSource={setSourceToDelete}
                />
                <GitHubSourceDeleteDialog
                  source={sourceToDelete}
                  deletingSourceId={deletingSourceId}
                  onOpenChange={(open) => {
                    if (!open) setSourceToDelete(null);
                  }}
                  onConfirm={(source) => void onDeleteGitHubSource(source)}
                />
              </div>
            </SettingsSection>

            <SettingsSection
              id="tokens"
              visible={effectiveActiveView === "tokens"}
              icon={<KeyRound size={18} />}
              title={t("settings.tokens")}
              description={t("settings.tokens_description")}
            >
              <div className="flex flex-col gap-5">
                <SettingsBlock>
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)]">
                        <KeyRound size={17} />
                      </span>
                      <div>
                        <h3 className="text-sm font-bold text-[color:var(--ink)]">
                          {t("settings.new_token")}
                        </h3>
                        <p className="text-sm text-[color:var(--ink-soft)]">
                          {t("settings.new_token_description")}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <div className="min-w-0 flex-1">
                        <Field label={t("settings.token_label")} htmlFor="settings-token-label">
                          <Input
                            id="settings-token-label"
                            value={tokenLabel}
                            onChange={(event) => setTokenLabel(event.target.value)}
                            placeholder={t("settings.token_placeholder")}
                          />
                        </Field>
                      </div>
                      <Button
                        variant="primary"
                        type="button"
                        onClick={() => void onCreateToken()}
                        className="shrink-0"
                      >
                        <KeyRound size={16} />
                        {t("settings.create_token")}
                      </Button>
                    </div>
                  </div>
                </SettingsBlock>

                {newToken ? (
                  <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-amber-300/30 bg-amber-500/[0.06] p-4 dark:border-amber-500/25 dark:bg-amber-500/[0.08]">
                    <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
                      <ShieldAlert size={16} />
                      {t("settings.token_copy_warning")}
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <code className="min-w-0 flex-1 break-all rounded-[var(--radius-sm)] bg-[color:var(--surface)] px-3 py-2 text-sm font-mono text-[color:var(--ink)]">
                        {newToken}
                      </code>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => {
                          void copyText(newToken)
                            .then((didCopy) => {
                              if (didCopy) {
                                toast.success(t("settings.token_copied"));
                              } else {
                                toast.error(t("settings.token_copy_error"));
                              }
                            })
                            .catch(() => {
                              toast.error(t("settings.token_copy_error"));
                            });
                        }}
                      >
                        <Copy size={15} />
                        {t("settings.copy_token")}
                      </Button>
                    </div>
                  </div>
                ) : null}

                {(tokens ?? []).length ? (
                  <>
                    {activeTokens.length ? (
                      <TokenList
                        title={t("settings.active_tokens")}
                        tokens={activeTokens}
                        onRevoke={(tokenId) => setRevokeTokenId(tokenId)}
                      />
                    ) : null}

                    {revokedTokens.length ? (
                      <TokenList title={t("settings.revoked_tokens")} tokens={revokedTokens} />
                    ) : null}
                  </>
                ) : (
                  <EmptyState
                    icon={KeyRound}
                    title={t("settings.no_tokens")}
                    description={t("settings.no_tokens_description")}
                  />
                )}
                <Dialog
                  open={Boolean(revokeTokenId)}
                  onOpenChange={(open) => {
                    if (!open) setRevokeTokenId(null);
                  }}
                >
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{t("settings.revoke_token")}</DialogTitle>
                      <DialogDescription>
                        {t("settings.revoke_token_description")}
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button variant="ghost" onClick={() => setRevokeTokenId(null)}>
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={!revokeTokenId}
                        onClick={() => {
                          if (!revokeTokenId) return;
                          void revokeToken({ tokenId: revokeTokenId }).then(() =>
                            setRevokeTokenId(null),
                          );
                        }}
                      >
                        <Trash2 size={16} />
                        {t("settings.revoke_token")}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </SettingsSection>

            <SettingsSection
              id="danger"
              visible={effectiveActiveView === "danger"}
              icon={<ShieldAlert size={18} />}
              title={t("settings.danger")}
              description={t("settings.delete_account_description")}
              tone="danger"
              hideHeader
            >
              <SettingsBlock>
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)]">
                        <ShieldAlert size={18} />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-[color:var(--ink)]">
                          {t("settings.danger")}
                        </h3>
                      </div>
                    </div>
                    <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                      <DialogTrigger asChild>
                        <Button variant="destructive" type="button" className="sm:w-auto">
                          <Trash2 size={16} />
                          {t("settings.delete_account")}
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Delete account</DialogTitle>
                          <DialogDescription>
                            {t("settings.delete_account_confirm")}
                          </DialogDescription>
                        </DialogHeader>
                        <DeletionResourceSummary
                          publishers={deletionPublishers}
                          emptyLabel={t("settings.account_no_resources")}
                        />
                        <DialogFooter>
                          <Button variant="ghost" onClick={() => setDeleteDialogOpen(false)}>
                            Cancel
                          </Button>
                          <Button variant="destructive" onClick={() => void onDelete()}>
                            {t("settings.delete_account_permanently")}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>

                  <div className="flex items-start gap-3 rounded-[var(--radius-sm)] border border-red-300/20 bg-red-500/[0.04] p-4 dark:border-red-500/20 dark:bg-red-500/[0.06]">
                    <ShieldAlert
                      size={18}
                      className="mt-0.5 shrink-0 text-red-600 dark:text-red-400"
                    />
                    <div className="flex flex-col gap-1">
                      <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                        {t("settings.delete_account_warning")}
                      </p>
                      <p className="text-sm text-[color:var(--ink-soft)]">
                        {t("settings.delete_account_warning_detail")}
                      </p>
                    </div>
                  </div>
                </div>
              </SettingsBlock>
            </SettingsSection>
          </div>
        </div>
      </div>
    </main>
  );
}

function formatGitHubSourceSyncToast(
  stats:
    | {
        discovered?: number;
        inserted?: number;
        revived?: number;
        conflicts?: number;
      }
    | undefined,
) {
  const discovered = stats?.discovered ?? 0;
  const inserted = stats?.inserted ?? 0;
  const revived = stats?.revived ?? 0;
  const conflicts = stats?.conflicts ?? 0;
  const visibleChanges = inserted + revived;
  const details = [
    `${discovered} ${discovered === 1 ? "skill" : "skills"} found`,
    visibleChanges > 0
      ? `${visibleChanges} ${visibleChanges === 1 ? "skill" : "skills"} added`
      : null,
    conflicts > 0 ? `${conflicts} conflict${conflicts === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return `GitHub source synced (${details.join(", ")})`;
}

function DeletionResourceSummary({
  publishers,
  emptyLabel,
}: {
  publishers: PublisherMembership[];
  emptyLabel: string;
}) {
  const { t } = useLocale();
  const totals = publishers.reduce(
    (acc, entry) => {
      acc.skills += entry.publisher.stats?.skills ?? 0;
      acc.plugins += entry.publisher.stats?.packages ?? 0;
      return acc;
    },
    { skills: 0, plugins: 0 },
  );
  const resources = publishers.flatMap((entry) =>
    (entry.publisher.publishedItems ?? []).map((item) => ({
      ...item,
      publisherHandle: entry.publisher.handle,
    })),
  );
  const totalResources = totals.skills + totals.plugins;
  const summary =
    totalResources > 0
      ? t("settings.resources_summary", {
          skills: totals.skills,
          plugins: totals.plugins,
        })
      : emptyLabel;

  return (
    <div className="overflow-hidden rounded-[var(--radius-sm)] border border-red-300/40 bg-red-500/5 text-sm dark:border-red-500/30">
      <div className="border-b border-red-300/30 px-3 py-2 dark:border-red-500/25">
        <p className="font-semibold text-red-700 dark:text-red-300">
          {t("settings.resources_deleted")}
        </p>
        <p className="mt-1 text-[color:var(--ink-soft)]">{summary}</p>
      </div>
      {resources.length ? (
        <div className="max-h-72 divide-y divide-red-300/25 overflow-auto dark:divide-red-500/20">
          {resources.map((resource, index) => {
            const Icon = resource.kind === "plugin" ? Package : Code;
            return (
              <div
                key={`${resource.kind}:${resource.publisherHandle}:${resource.displayName}:${index}`}
                className="flex min-w-0 items-start gap-3 bg-[color:var(--surface)]/80 px-3 py-2.5"
              >
                <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] text-[color:var(--ink-soft)]">
                  <Icon size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <p className="truncate font-semibold text-[color:var(--ink)]">
                      {resource.displayName}
                    </p>
                    <Badge
                      variant={resource.kind === "plugin" ? "review" : publishedSkillBadgeVariant}
                      size="sm"
                      className="w-fit shrink-0 capitalize"
                    >
                      {t(`settings.resource_${resource.kind}`)}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-[color:var(--ink-soft)]">
                    @{resource.publisherHandle}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="bg-[color:var(--surface)]/80 px-3 py-3 text-sm text-[color:var(--ink-soft)]">
          {emptyLabel}
        </p>
      )}
    </div>
  );
}

function SettingsSection({
  id,
  icon,
  title,
  description,
  children,
  tone,
  headerAside,
  hideHeader = true,
  visible = true,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
  tone?: "danger";
  headerAside?: ReactNode;
  hideHeader?: boolean;
  visible?: boolean;
}) {
  if (!visible) return null;

  return (
    <section
      id={id}
      aria-label={`${title}. ${description}`}
      className="scroll-mt-[var(--settings-scroll-margin)] lg:min-h-[calc(100vh-var(--settings-scroll-margin))]"
    >
      <div className="flex min-h-full flex-col gap-5">
        {hideHeader ? null : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 gap-3">
              <span
                className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border ${
                  tone === "danger"
                    ? "border-red-300/40 bg-red-500/10 text-red-700 dark:border-red-500/30 dark:text-red-300"
                    : "border-[color:var(--line)] bg-[color:var(--surface-muted)] text-[color:var(--ink)]"
                }`}
              >
                {icon}
              </span>
              <div className="min-w-0">
                <h2
                  className={`font-display text-2xl font-black leading-none ${
                    tone === "danger" ? "text-red-700 dark:text-red-300" : "text-[color:var(--ink)]"
                  }`}
                >
                  {title}
                </h2>
              </div>
            </div>
            {headerAside ? <div className="shrink-0">{headerAside}</div> : null}
          </div>
        )}
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}

function SettingsBlock({
  children,
  tone,
  className = "",
}: {
  children: ReactNode;
  tone?: "danger";
  className?: string;
}) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-4 rounded-[var(--radius-md)] border p-4 sm:p-5 ${
        tone === "danger"
          ? "border-red-300/50 bg-red-500/[0.035] dark:border-red-500/35 dark:bg-red-500/[0.045]"
          : "border-[color:var(--line)] bg-[color:var(--surface)]"
      } ${className}`}
    >
      {children}
    </div>
  );
}

function OrgLogo({
  image,
  name,
  handle,
  className,
}: {
  image?: string | null;
  name: string;
  handle: string;
  className?: string;
}) {
  return (
    <span
      className={`settings-org-logo inline-flex overflow-hidden rounded-[var(--radius-sm)] ${className ?? ""}`}
    >
      <MarketplaceIcon kind="org" label={name || handle} imageUrl={image} size="md" />
    </span>
  );
}

function OrgLogoSmall({
  image,
  name,
  handle,
  className,
}: {
  image?: string | null;
  name: string;
  handle: string;
  className?: string;
}) {
  return (
    <span
      className={`settings-org-logo inline-flex overflow-hidden rounded-[var(--radius-sm)] ${className ?? ""}`}
    >
      <MarketplaceIcon kind="org" label={name || handle} imageUrl={image} size="xs" />
    </span>
  );
}

function GitHubSourceList({
  sources,
  deletingSourceId,
  onDeleteSource,
}: {
  sources: GitHubSkillSource[] | undefined;
  deletingSourceId: Id<"githubSkillSources"> | null;
  onDeleteSource: (source: GitHubSkillSource) => void;
}) {
  const { t } = useLocale();
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby="github-synced-repos-title">
      <div className="flex items-center gap-2">
        <h3 id="github-synced-repos-title" className="text-sm font-bold text-[color:var(--ink)]">
          {t("settings.synced_repositories")}
        </h3>
        <span className="inline-flex h-5 items-center rounded-full border border-[color:var(--line)] bg-[color:var(--surface-muted)] px-2 text-[11px] font-semibold text-[color:var(--ink-soft)]">
          {sources?.length ?? 0}
        </span>
      </div>

      {sources === undefined ? (
        <p className="text-sm text-[color:var(--ink-soft)]">{t("settings.loading_sources")}</p>
      ) : sources.length ? (
        <div className="flex flex-col gap-3">
          {sources.map((source) => (
            <SettingsBlock key={source._id} className="overflow-hidden p-0 sm:p-0">
              <div className="flex flex-col gap-3 p-4 sm:p-5">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)]">
                      <GitBranch size={17} />
                    </span>
                    <div className="min-w-0">
                      <h4 className="truncate text-base font-bold text-[color:var(--ink)]">
                        {source.repo}
                      </h4>
                      <a
                        href={`https://github.com/${source.repo}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 block truncate text-sm text-[color:var(--ink-soft)] hover:text-[color:var(--ink-soft)] visited:text-[color:var(--ink-soft)]"
                      >
                        {`https://github.com/${source.repo}`}
                      </a>
                      {source.ownerPublisher ? (
                        <div className="mt-1 truncate text-xs font-semibold text-[color:var(--ink-soft)]">
                          @{source.ownerPublisher.handle}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <GitHubSourceHealth source={source} />

                <GitHubSourceSyncIssues source={source} />

                <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)]">
                  <div className="flex items-center gap-2 border-b border-[color:var(--line)] px-3 py-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--ink-soft)]">
                      {t("settings.synced_skills")}
                    </span>
                    <span className="inline-flex h-5 items-center rounded-full border border-[color:var(--line)] bg-[color:var(--surface-muted)] px-2 text-[11px] font-semibold text-[color:var(--ink-soft)]">
                      {source.skills.length}
                    </span>
                  </div>
                  {source.skills.length ? (
                    <div className="divide-y divide-[color:var(--line)]">
                      {source.skills.map((skill) => (
                        <div
                          key={skill._id}
                          className="flex min-w-0 flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <Link
                              to="/$owner/$slug"
                              params={{
                                owner: source.ownerPublisher?.handle ?? "",
                                slug: skill.slug,
                              }}
                              disabled={!source.ownerPublisher}
                              className="block truncate text-sm font-semibold text-[color:var(--ink)] no-underline hover:text-[color:var(--accent)] hover:no-underline"
                            >
                              {skill.displayName}
                            </Link>
                            <div className="truncate text-xs text-[color:var(--ink-soft)]">
                              {skill.githubPath ?? skill.slug}
                            </div>
                          </div>
                          <span className="shrink-0 text-xs font-mono text-[color:var(--ink-soft)]">
                            {skill.slug}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="px-3 py-3 text-sm text-[color:var(--ink-soft)]">
                      {t("settings.no_synced_skills")}
                    </p>
                  )}
                </div>

                <div className="-mx-4 -mb-4 flex flex-col gap-3 border-t border-[color:var(--line)] px-4 py-4 sm:-mx-5 sm:-mb-5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <div className="min-w-0">
                    <h5 className="text-sm font-bold text-[color:var(--ink)]">
                      {t("settings.delete_synced_repo")}
                    </h5>
                    <p className="mt-1 text-sm leading-6 text-[color:var(--ink-soft)]">
                      {t("settings.delete_synced_repo_description")}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    loading={deletingSourceId === source._id}
                    className="shrink-0 border-red-500/45 text-red-700 hover:not-disabled:border-red-500 hover:not-disabled:bg-red-500/10 dark:border-red-500/35 dark:text-red-300"
                    onClick={() => onDeleteSource(source)}
                  >
                    {t("common.delete")}
                  </Button>
                </div>
              </div>
            </SettingsBlock>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={GitBranch}
          title={t("settings.no_synced_repositories")}
          description={t("settings.no_synced_repositories_description")}
        />
      )}
    </section>
  );
}

function GitHubSourceDeleteDialog({
  source,
  deletingSourceId,
  onOpenChange,
  onConfirm,
}: {
  source: GitHubSkillSource | null;
  deletingSourceId: Id<"githubSkillSources"> | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (source: GitHubSkillSource) => void;
}) {
  const { t } = useLocale();
  const isDeleting = Boolean(source && deletingSourceId === source._id);

  return (
    <Dialog open={Boolean(source)} onOpenChange={onOpenChange}>
      <DialogContent className="flex w-[min(100%,640px)] flex-col gap-4">
        <DialogHeader>
          <DialogTitle>
            {t("settings.delete_repo_title", {
              repo: source?.repo ?? t("settings.synced_repositories"),
            })}
          </DialogTitle>
          <DialogDescription>{t("settings.delete_synced_repo_description")}</DialogDescription>
        </DialogHeader>

        <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)]">
          <div className="border-b border-[color:var(--line)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--ink-soft)]">
            {t("settings.skills_to_delete")}
          </div>
          {source?.skills.length ? (
            <div className="max-h-72 divide-y divide-[color:var(--line)] overflow-auto">
              {source.skills.map((skill) => (
                <div
                  key={skill._id}
                  className="flex min-w-0 flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[color:var(--ink)]">
                      {skill.displayName}
                    </div>
                    <div className="truncate text-xs text-[color:var(--ink-soft)]">
                      {skill.githubPath ?? skill.slug}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs font-mono text-[color:var(--ink-soft)]">
                    {skill.slug}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-3 py-3 text-sm text-[color:var(--ink-soft)]">
              No published skills are currently synced from this repo.
            </p>
          )}
        </div>

        <DialogFooter className="sm:block">
          <Button
            variant="destructive"
            type="button"
            className="w-full"
            disabled={!source || isDeleting}
            loading={isDeleting}
            onClick={() => {
              if (source) onConfirm(source);
            }}
          >
            <Trash2 size={16} />
            Delete synced repo &amp; skills
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GitHubSourceHealth({ source }: { source: GitHubSkillSource }) {
  const { t, locale } = useLocale();
  const needsAttention =
    source.lastSyncStatus === "failed" ||
    source.displayManifestStatus === "failed" ||
    source.displayManifestStatus === "invalid";
  const latestError =
    source.lastSyncError ??
    (source.displayManifestStatus === "invalid"
      ? t("settings.invalid_manifest")
      : source.displayManifestStatus === "failed"
        ? t("settings.github_sync_failed")
        : null);
  const lastSuccessfulSync =
    source.displayManifestFetchedAt ?? (source.lastSyncStatus === "ok" ? source.updatedAt : null);

  return (
    <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)]">
      <div className="border-b border-[color:var(--line)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--ink-soft)]">
        {t("settings.overview")}
      </div>
      <div className="divide-y divide-[color:var(--line)]">
        <GitHubSourceOverviewRow label={t("settings.status")}>
          <GitHubSourceStatusPill needsAttention={needsAttention} />
        </GitHubSourceOverviewRow>
        <GitHubSourceOverviewRow label={t("settings.last_synced")}>
          {lastSuccessfulSync
            ? formatSettingsTimeAgo(lastSuccessfulSync, locale)
            : t("settings.never")}
        </GitHubSourceOverviewRow>
        <GitHubSourceOverviewRow label={t("settings.current_commit")}>
          {source.displayManifestCommit ? (
            <a
              href={`https://github.com/${source.repo}/commit/${source.displayManifestCommit}`}
              target="_blank"
              rel="noreferrer"
              className="text-[color:var(--ink-soft)] no-underline hover:text-[color:var(--accent)] hover:no-underline visited:text-[color:var(--ink-soft)]"
            >
              {shortCommit(source.displayManifestCommit)}
            </a>
          ) : (
            t("settings.none")
          )}
        </GitHubSourceOverviewRow>
      </div>
      {needsAttention && latestError ? (
        <p className="border-t border-[color:var(--line)] px-3 py-2 text-sm text-red-700 dark:text-red-300">
          <span className="font-semibold">{t("settings.latest_error")}</span> {latestError}
        </p>
      ) : null}
    </div>
  );
}

function GitHubSourceSyncIssues({ source }: { source: GitHubSkillSource }) {
  const { t } = useLocale();
  const issues = getGitHubSourceSyncIssues(source);
  if (issues.length === 0) return null;

  return (
    <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)]">
      <div className="flex items-center gap-2 border-b border-[color:var(--line)] px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--ink-soft)]">
          {t("settings.sync_issues")}
        </span>
        <span className="inline-flex h-5 items-center rounded-full border border-red-500/35 bg-red-500/10 px-2 text-[11px] font-semibold text-red-700 dark:text-red-300">
          {issues.length}
        </span>
      </div>
      <div className="divide-y divide-[color:var(--line)]">
        {issues.map((skill) => (
          <div
            key={`${skill.path}:${skill.slug}`}
            className="flex min-w-0 flex-col gap-1 px-3 py-2 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-[color:var(--ink)]">
                {skill.displayName}
              </div>
              <div className="truncate text-xs text-[color:var(--ink-soft)]">{skill.path}</div>
              <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ink-soft)]">
                {t(`settings.${formatGitHubSourceIssueKind(skill.kind)}`)}
              </div>
            </div>
            <div className="shrink-0 text-left text-xs font-semibold text-red-700 dark:text-red-300 sm:max-w-[40%] sm:text-right">
              {skill.message}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function getGitHubSourceSyncIssues(source: GitHubSkillSource) {
  return (
    source.lastSyncIssues ??
    source.lastSyncInvalidSkills?.map((skill) => ({
      slug: skill.slug,
      path: skill.path,
      displayName: skill.displayName,
      kind: "invalid_slug" as const,
      severity: "error" as const,
      message: skill.error,
    })) ??
    []
  );
}

function formatGitHubSourceIssueKind(
  kind: NonNullable<GitHubSkillSource["lastSyncIssues"]>[number]["kind"],
) {
  switch (kind) {
    case "invalid_slug":
      return "invalid_slug";
    case "slug_conflict":
      return "slug_conflict";
    default:
      return kind;
  }
}

function GitHubSourceOverviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--ink)] sm:text-[11px]">
        {label}
      </div>
      <div className="min-w-0 truncate text-sm font-semibold text-[color:var(--ink-soft)]">
        {children}
      </div>
    </div>
  );
}

function GitHubSourceStatusPill({ needsAttention }: { needsAttention: boolean }) {
  const { t } = useLocale();
  return (
    <span
      className={`inline-flex h-6 items-center rounded-full border px-2.5 text-xs font-semibold ${
        needsAttention
          ? "border-red-500/35 bg-red-500/10 text-red-700 dark:text-red-300"
          : "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      }`}
    >
      {needsAttention ? t("settings.needs_attention") : t("settings.healthy")}
    </span>
  );
}

function GitHubSourceForm({
  publisherOptions,
  selectedPublisherId,
  onPublisherChange,
  githubRepo,
  onGithubRepoChange,
  onConfigure,
  isSyncing,
}: {
  publisherOptions: PublisherMembership[];
  selectedPublisherId: string;
  onPublisherChange: (publisherId: string) => void;
  githubRepo: string;
  onGithubRepoChange: (repo: string) => void;
  onConfigure: (event: FormEvent) => void;
  isSyncing: boolean;
}) {
  const { t } = useLocale();
  return (
    <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={onConfigure}>
      <div className="min-w-0 sm:w-64 sm:shrink-0">
        <Field label={t("settings.publisher")} htmlFor="settings-github-source-publisher">
          <Select value={selectedPublisherId} onValueChange={onPublisherChange}>
            <SelectTrigger id="settings-github-source-publisher">
              <SelectValue placeholder={t("settings.select_publisher")} />
            </SelectTrigger>
            <SelectContent>
              {publisherOptions.map((entry) => (
                <SelectItem key={entry.publisher._id} value={entry.publisher._id}>
                  @{entry.publisher.handle}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Field label={t("settings.github_repo_url")} htmlFor="settings-github-repo">
            <Input
              id="settings-github-repo"
              value={githubRepo}
              onChange={(event) => onGithubRepoChange(event.target.value)}
              placeholder="https://github.com/owner/repo"
            />
          </Field>
        </div>
        <Button type="submit" disabled={!githubRepo.trim() || isSyncing} className="shrink-0">
          <Plus size={16} />
          {isSyncing ? t("settings.adding_repo") : t("settings.add_repo")}
        </Button>
      </div>
    </form>
  );
}

function shortCommit(commit: string) {
  return commit.slice(0, 7);
}

function parseGitHubRepoInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const markdownUrl = trimmed.match(/\]\((https?:\/\/[^)]+)\)$/i)?.[1];
  const raw = markdownUrl ?? trimmed;
  const normalized = raw
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, "")
    .replace(/^github\.com\//i, "")
    .replace(/\.git$/i, "")
    .split(/[?#]/)[0];
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  return trimmed;
}

function TokenList({
  title,
  tokens,
  onRevoke,
}: {
  title: string;
  tokens: ApiToken[];
  onRevoke?: (tokenId: Id<"apiTokens">) => void;
}) {
  const { t, locale } = useLocale();
  const isRevokedList = tokens.every((token) => token.revokedAt);

  return (
    <SettingsBlock className="gap-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)]">
            <KeyRound size={16} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-[color:var(--ink)]">{title}</h3>
              <span className="inline-flex h-5 items-center rounded-full border border-[color:var(--line)] bg-[color:var(--surface-muted)] px-2 text-[11px] font-semibold text-[color:var(--ink-soft)]">
                {tokens.length}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="hidden lg:block">
        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col />
            <col className="w-40" />
            <col className="w-40" />
            <col className="w-28" />
          </colgroup>
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--ink-muted)]">
              <th className="pb-3 text-left font-semibold">
                <span className="pl-7">{t("settings.token_name")}</span>
              </th>
              <th className="pb-3 text-left font-semibold">{t("settings.token_created_label")}</th>
              <th className="pb-3 text-left font-semibold">
                {t("settings.token_last_used_label")}
              </th>
              <th className="pb-3 text-right font-semibold">
                {isRevokedList ? t("settings.token_revoked") : t("settings.token_action")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--line)]">
            {tokens.map((token) => (
              <tr key={token._id}>
                <td className="py-4 align-middle">
                  <div className="flex min-w-0 items-center gap-3">
                    {token.revokedAt ? (
                      <CircleX size={16} aria-hidden="true" className="shrink-0 text-red-500" />
                    ) : (
                      <Code
                        size={16}
                        aria-hidden="true"
                        className="shrink-0 text-[color:var(--ink-muted)] opacity-60"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[color:var(--ink)]">
                        {token.label}
                      </div>
                      <code className="font-mono text-xs text-[color:var(--ink-soft)]">
                        {token.prefix}...
                      </code>
                    </div>
                  </div>
                </td>
                <td className="py-4 align-middle text-xs text-[color:var(--ink-soft)]">
                  {formatShortDate(token.createdAt, locale)}
                </td>
                <td className="py-4 align-middle">
                  <span
                    className={
                      token.lastUsedAt
                        ? "text-xs text-[color:var(--ink-soft)]"
                        : "text-xs font-semibold text-[color:var(--ink-muted)] opacity-70"
                    }
                  >
                    {token.lastUsedAt
                      ? formatShortDate(token.lastUsedAt, locale)
                      : t("settings.token_never_used")}
                  </span>
                </td>
                <td className="py-4 text-right align-middle">
                  {token.revokedAt ? (
                    <span className="text-xs text-[color:var(--ink-soft)]">
                      {formatShortDate(token.revokedAt, locale)}
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={() => onRevoke?.(token._id)}
                      className="h-8 gap-2 px-0 text-xs text-red-700 hover:bg-transparent hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                    >
                      <Trash2 size={14} />
                      {t("settings.revoke_token")}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2 lg:hidden">
        {tokens.map((token) => (
          <div
            key={token._id}
            className="grid gap-3 rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)]/25 p-3"
          >
            <div className="flex min-w-0 items-center gap-2">
              {token.revokedAt ? (
                <CircleX size={16} aria-hidden="true" className="shrink-0 text-red-500" />
              ) : (
                <Code
                  size={16}
                  aria-hidden="true"
                  className="shrink-0 text-[color:var(--ink-muted)] opacity-60"
                />
              )}
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="min-w-0 truncate text-sm font-semibold text-[color:var(--ink)]">
                  {token.label}
                </span>
                <code className="min-w-0 truncate font-mono text-xs text-[color:var(--ink-soft)]">
                  {token.prefix}...
                </code>
              </div>
            </div>

            <div className="flex items-center justify-between lg:block">
              <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--ink-muted)] lg:hidden">
                {t("settings.token_created_label")}
              </span>
              <span className="text-xs text-[color:var(--ink-soft)]">
                {formatShortDate(token.createdAt, locale)}
              </span>
            </div>

            <div className="flex items-center justify-between lg:block">
              <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--ink-muted)] lg:hidden">
                {t("settings.token_last_used_label")}
              </span>
              <span
                className={
                  token.lastUsedAt
                    ? "text-xs text-[color:var(--ink-soft)]"
                    : "text-xs font-semibold text-[color:var(--ink-muted)] opacity-70"
                }
              >
                {token.lastUsedAt
                  ? formatShortDate(token.lastUsedAt, locale)
                  : t("settings.token_never_used")}
              </span>
            </div>

            <div className="flex justify-start lg:justify-end">
              {token.revokedAt ? (
                <span className="text-xs text-[color:var(--ink-soft)]">
                  {t("settings.token_revoked_at", {
                    time: formatShortDate(token.revokedAt, locale),
                  })}
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => onRevoke?.(token._id)}
                  className="h-8 gap-2 px-0 text-xs text-red-700 hover:bg-transparent hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                >
                  <Trash2 size={14} />
                  Revoke
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </SettingsBlock>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 w-full flex-col gap-2">
      <Label
        htmlFor={htmlFor}
        className="text-[14px] font-semibold tracking-[0.04em] text-[color:var(--ink-soft)]"
      >
        {label}
      </Label>
      {children}
    </div>
  );
}

function useActiveSettingsView() {
  const navigate = useNavigate({ from: "/settings" });
  const search = useSearch({ from: "/settings" });
  const [migratedHashView, setMigratedHashView] = useState<SettingsView | null>(null);
  const [hasCheckedHash, setHasCheckedHash] = useState(false);
  const activeView = isSettingsView(search.view) ? search.view : (migratedHashView ?? "account");

  useEffect(() => {
    if (hasCheckedHash) return;
    setHasCheckedHash(true);
    const hash = window.location.hash.replace("#", "");
    if (isSettingsView(hash)) {
      setMigratedHashView(hash);
      void navigate({ search: { view: hash }, replace: true });
    }
  }, [hasCheckedHash, navigate]);

  const navigateToView = (view: SettingsView) => {
    void navigate({ search: { view } });
  };

  return { activeView, navigateToView };
}

function formatSettingsTimeAgo(value: number, locale: string) {
  const elapsedSeconds = Math.round((value - Date.now()) / 1_000);
  const units = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ] as const;
  const [unit, seconds] = units.find(([, threshold]) => Math.abs(elapsedSeconds) >= threshold) ?? [
    "second",
    1,
  ];

  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
    Math.round(elapsedSeconds / seconds),
    unit,
  );
}

function formatShortDate(value: number, locale: string) {
  try {
    return new Date(value).toLocaleString(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(value);
  }
}
