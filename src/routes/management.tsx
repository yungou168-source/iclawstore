import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  Building2,
  ChevronRight,
  ClipboardList,
  FileCheck2,
  GitBranch,
  Link2,
  PackageSearch,
  Plug,
  ShieldCheck,
  UserRound,
  WalletCards,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { ApprovalCenterPage } from "../components/ai-direct/ApprovalCenterPage";
import { AuditCenterPage } from "../components/ai-direct/AuditCenterPage";
import { ManagementInsightsPage } from "../components/ai-direct/ManagementInsightsPage";
import { OrganizationAdminPage } from "../components/ai-direct/OrganizationAdminPage";
import { SettlementOperationsPage } from "../components/ai-direct/SettlementOperationsPage";
import { TemplateReviewPage } from "../components/ai-direct/TemplateReviewPage";
import { WalletOperationsPage } from "../components/ai-direct/WalletOperationsPage";
import { ManagementSkeleton } from "../components/skeletons/ProtectedPageSkeletons";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Textarea } from "../components/ui/textarea";
import { aiDirectPaidHiringApi } from "../lib/aiDirectPaidHiringApi";
import { useLocale } from "../lib/i18n/context";
import type { TranslationKey } from "../lib/i18n/translations";
import { isAdmin, isModerator } from "../lib/roles";
import { useAuthStatus } from "../lib/useAuthStatus";
import {
  AbusePage,
  canBanPublisherAbuseOwner,
  comparePublisherAbuseItems,
  filterPublisherAbuseItems,
  getPublisherAbuseItemsForTab,
  getPublisherAbuseVisiblePendingItems,
} from "./-management/AbusePage";
import { DuplicatesPage } from "./-management/DuplicatesPage";
import { FriendlyLinksPage } from "./-management/FriendlyLinksPage";
import {
  formatManagementUserLabel,
  formatMutationError,
  formatWholeNumber,
  SKILL_AUDIT_LOG_LIMIT,
  type DuplicateCandidateEntry,
  type ManagementOwnerOption,
  type ManagementUserListResult,
  type ManagementView,
  type PluginByNameResult,
  type PublisherAbuseReviewItem,
  type PublisherAbuseTab,
  type RecentVersionEntry,
  type ReportedSkillEntry,
  type SkillBySlugResult,
  USER_BAN_REASON_MAX_LENGTH,
} from "./-management/managementShared";
import { PluginsPage } from "./-management/PluginsPage";
import { RecentPushesPage } from "./-management/RecentPushesPage";
import { ReportsPage } from "./-management/ReportsPage";
import { SkillsPage } from "./-management/SkillsPage";
import { UsersPage } from "./-management/UsersPage";

const MANAGEMENT_VIEWS = new Set<string>([
  "overview",
  "abuse",
  "reports",
  "users",
  "publishers",
  "skills",
  "plugins",
  "duplicates",
  "recent",
  "organizations",
  "templates",
  "wallets",
  "settlements",
  "audit",
  "system",
  "employees",
  "costs",
  "approvals",
  "friendly-links",
  "settings",
]);

function isManagementView(value: unknown): value is ManagementView {
  return typeof value === "string" && MANAGEMENT_VIEWS.has(value);
}

type ManagementConfirmRequest = {
  title: string;
  body?: string;
  confirmLabel: string;
  destructive?: boolean;
  reason?: {
    label: string;
    placeholder?: string;
    required?: boolean;
    maxLength?: number;
  };
  onConfirm: (reason: string | undefined) => void;
};

// Convex `useQuery` returns undefined while a new query (e.g. a changed search arg)
// is in flight. Keep the previous result visible during that window so search-driven
// lists do not blank out to a loading state on every keystroke.
function useStableQuery<T>(value: T | undefined): T | undefined {
  const ref = useRef<T | undefined>(value);
  if (value !== undefined) ref.current = value;
  return ref.current;
}

function ManagementConfirmDialog({
  request,
  onClose,
}: {
  request: ManagementConfirmRequest | null;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const [reason, setReason] = useState("");

  useEffect(() => {
    setReason("");
  }, [request]);

  const reasonRequired = request?.reason?.required ?? false;
  const canConfirm = !reasonRequired || reason.trim().length > 0;

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="management-confirm">
        <DialogHeader>
          <DialogTitle>{request?.title}</DialogTitle>
          {request?.body ? <DialogDescription>{request.body}</DialogDescription> : null}
        </DialogHeader>
        {request?.reason ? (
          <label className="management-confirm-field">
            <span>{request.reason.label}</span>
            <Textarea
              autoFocus
              rows={3}
              maxLength={request.reason.maxLength}
              placeholder={request.reason.placeholder}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("management.cancel")}
          </Button>
          <Button
            type="button"
            variant={request?.destructive ? "destructive" : "primary"}
            disabled={!canConfirm}
            onClick={() => {
              request?.onConfirm(reason.trim() || undefined);
              onClose();
            }}
          >
            {request?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const Route = createFileRoute("/management")({
  validateSearch: (search) => {
    const validated: {
      skill?: string;
      plugin?: string;
      view?: ManagementView;
    } = {};
    if (typeof search.skill === "string" && search.skill.trim()) {
      validated.skill = search.skill;
    }
    if (typeof search.plugin === "string" && search.plugin.trim()) {
      validated.plugin = search.plugin;
    }
    if (isManagementView(search.view)) {
      validated.view = search.view;
    }
    return validated;
  },
  component: Management,
});

export function Management() {
  const { t } = useLocale();
  const { isLoading: isAuthLoading, me } = useAuthStatus();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const staff = isModerator(me);
  const admin = isAdmin(me);
  const [settlementStaff, setSettlementStaff] = useState(false);

  useEffect(() => {
    let active = true;
    if (!me) {
      setSettlementStaff(false);
      return () => {
        active = false;
      };
    }
    void aiDirectPaidHiringApi
      .listPayableBalances({ limit: 1 })
      .then(() => {
        if (active) setSettlementStaff(true);
      })
      .catch(() => {
        if (active) setSettlementStaff(false);
      });
    return () => {
      active = false;
    };
  }, [me?._id]);

  const selectedSlug = search.skill?.trim();
  const selectedPluginName = search.plugin?.trim();
  const activeView = resolveManagementView(search.view, selectedSlug, selectedPluginName);
  const abuseViewActive = activeView === "abuse";
  const selectedSkill = useQuery(
    api.skills.getBySlugForStaff,
    staff && selectedSlug ? { slug: selectedSlug, auditLogLimit: SKILL_AUDIT_LOG_LIMIT } : "skip",
  ) as SkillBySlugResult | undefined;
  const selectedPlugin = useQuery(
    api.packages.getByNameForStaff,
    staff && selectedPluginName ? { name: selectedPluginName } : "skip",
  ) as PluginByNameResult | undefined;
  const selectedSkillId = selectedSkill?.skill?._id ?? null;
  const recentVersions = useQuery(api.skills.listRecentVersions, staff ? { limit: 20 } : "skip") as
    | RecentVersionEntry[]
    | undefined;
  const reportedSkills = useQuery(api.skills.listReportedSkills, staff ? { limit: 25 } : "skip") as
    | ReportedSkillEntry[]
    | undefined;
  const duplicateCandidates = useQuery(
    api.skills.listDuplicateCandidates,
    staff ? { limit: 20 } : "skip",
  ) as DuplicateCandidateEntry[] | undefined;
  const publisherAbuseDashboard = useQuery(
    api.publisherAbuse.listReviewDashboard,
    staff && abuseViewActive ? { limit: 150 } : "skip",
  );

  const setRole = useMutation(api.users.setRole);
  const banUser = useMutation(api.users.banUser);
  const unbanUser = useMutation(api.users.unbanUser);
  const setBatch = useMutation(api.skills.setBatch);
  const setPackageBatch = useMutation(api.packages.setBatch);
  const setSoftDeleted = useMutation(api.skills.setSoftDeleted);
  const hardDelete = useMutation(api.skills.hardDelete);
  const changeOwner = useMutation(api.skills.changeOwner);
  const setDuplicate = useMutation(api.skills.setDuplicate);
  const setOfficialBadge = useMutation(api.skills.setOfficialBadge);
  const setDeprecatedBadge = useMutation(api.skills.setDeprecatedBadge);
  const setSkillManualOverride = useMutation(api.skills.setSkillManualOverride);
  const clearSkillManualOverride = useMutation(api.skills.clearSkillManualOverride);
  const banPublisherAbuseOwnerMutation = useMutation(api.publisherAbuse.banPublisherAbuseOwner);
  const startPublisherAbuseScoreRun = useAction(api.publisherAbuse.startPublisherAbuseScoreRun);

  const [selectedDuplicate, setSelectedDuplicate] = useState("");
  const [selectedOwner, setSelectedOwner] = useState<Id<"users"> | "">("");
  const [reportSearch, setReportSearch] = useState("");
  const [reportSearchDebounced, setReportSearchDebounced] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userSearchDebounced, setUserSearchDebounced] = useState("");
  const [ownerSearch, setOwnerSearch] = useState("");
  const [ownerSearchDebounced, setOwnerSearchDebounced] = useState("");
  const [pluginSearch, setPluginSearch] = useState(selectedPluginName ?? "");
  const [skillSearch, setSkillSearch] = useState(selectedSlug ?? "");
  const [skillOverrideNote, setSkillOverrideNote] = useState("");
  const [confirmRequest, setConfirmRequest] = useState<ManagementConfirmRequest | null>(null);
  const [publisherAbuseTab, setPublisherAbuseTab] =
    useState<PublisherAbuseTab>("potential_ban_candidate");
  const [publisherAbuseSearch, setPublisherAbuseSearch] = useState("");
  const [publisherAbuseNotes, setPublisherAbuseNotes] = useState("");
  const [selectedPublisherAbuseNominationId, setSelectedPublisherAbuseNominationId] =
    useState<Id<"publisherAbuseReviewNominations"> | null>(null);

  const userQuery = userSearchDebounced.trim();
  const userResult = useStableQuery(
    useQuery(
      api.users.list,
      admin && activeView === "users" ? { limit: 200, search: userQuery || undefined } : "skip",
    ) as ManagementUserListResult | undefined,
  );
  const ownerQuery = ownerSearchDebounced.trim();
  const ownerResult = useStableQuery(
    useQuery(
      api.users.list,
      admin && activeView === "skills" ? { limit: 200, search: ownerQuery || undefined } : "skip",
    ) as ManagementUserListResult | undefined,
  );
  const selectedPublisherAbuseDetail = useQuery(
    api.publisherAbuse.getReviewNominationDetail,
    staff && abuseViewActive && selectedPublisherAbuseNominationId
      ? { nominationId: selectedPublisherAbuseNominationId }
      : "skip",
  );

  const selectedOwnerUserId = selectedSkill?.skill?.ownerUserId ?? null;
  const selectedCanonicalSlug = selectedSkill?.canonical?.skill?.slug ?? "";
  const publisherAbuseItemsForTab = useMemo(
    () =>
      publisherAbuseDashboard
        ? getPublisherAbuseItemsForTab(publisherAbuseDashboard, publisherAbuseTab)
        : [],
    [publisherAbuseDashboard, publisherAbuseTab],
  );
  const filteredPublisherAbuseItems = useMemo(() => {
    const filtered = filterPublisherAbuseItems(publisherAbuseItemsForTab, publisherAbuseSearch);
    if (publisherAbuseTab === "resolved") return filtered;
    return filtered.sort(comparePublisherAbuseItems);
  }, [publisherAbuseItemsForTab, publisherAbuseSearch, publisherAbuseTab]);
  const fallbackSelectedPublisherAbuseItem =
    publisherAbuseItemsForTab.find(
      (item) => item.nomination._id === selectedPublisherAbuseNominationId,
    ) ?? null;
  const selectedPublisherAbuseItem =
    selectedPublisherAbuseDetail?.item ?? fallbackSelectedPublisherAbuseItem;

  useEffect(() => {
    if (!selectedSkillId || !selectedOwnerUserId) return;
    setSelectedDuplicate(selectedCanonicalSlug);
    setSelectedOwner(selectedOwnerUserId);
  }, [selectedCanonicalSlug, selectedOwnerUserId, selectedSkillId]);

  useEffect(() => {
    setSkillOverrideNote("");
  }, [selectedSkillId]);

  useEffect(() => {
    setPluginSearch(selectedPluginName ?? "");
  }, [selectedPluginName]);

  useEffect(() => {
    setSkillSearch(selectedSlug ?? "");
  }, [selectedSlug]);

  useEffect(() => {
    const handle = setTimeout(() => setReportSearchDebounced(reportSearch), 250);
    return () => clearTimeout(handle);
  }, [reportSearch]);

  useEffect(() => {
    const handle = setTimeout(() => setUserSearchDebounced(userSearch), 250);
    return () => clearTimeout(handle);
  }, [userSearch]);

  useEffect(() => {
    const handle = setTimeout(() => setOwnerSearchDebounced(ownerSearch), 250);
    return () => clearTimeout(handle);
  }, [ownerSearch]);

  // Detail opens in a drawer on row click. If the selected nomination leaves the
  // current tab/filter, close the drawer rather than auto-opening another one.
  useEffect(() => {
    if (!selectedPublisherAbuseNominationId) return;
    const stillVisible = filteredPublisherAbuseItems.some(
      (item) => item.nomination._id === selectedPublisherAbuseNominationId,
    );
    if (!stillVisible) setSelectedPublisherAbuseNominationId(null);
  }, [filteredPublisherAbuseItems, selectedPublisherAbuseNominationId]);

  useEffect(() => {
    setPublisherAbuseNotes("");
  }, [selectedPublisherAbuseNominationId]);

  if (isAuthLoading) {
    return <ManagementSkeleton />;
  }

  if (!staff) {
    return (
      <main className="section">
        <Card>{t("management.management_only")}</Card>
      </main>
    );
  }

  const reportQuery = reportSearchDebounced.trim().toLowerCase();
  const filteredReportedSkills = reportedSkills?.filter((entry) => {
    if (!reportQuery) return true;
    const reportReasons = (entry.reports ?? []).map((report) => report.reason).join(" ");
    const reporterHandles = (entry.reports ?? [])
      .map((report) => report.reporterHandle)
      .filter(Boolean)
      .join(" ");
    const haystack = [
      entry.skill.displayName,
      entry.skill.slug,
      entry.owner?.handle,
      entry.owner?.name,
      reportReasons,
      reporterHandles,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(reportQuery);
  });
  const reportCountLabel =
    filteredReportedSkills?.length === 0 && (reportedSkills?.length ?? 0) > 0
      ? t("management.no_matching_reports")
      : t("management.no_reports");
  const reportSummary = reportedSkills
    ? t("management.showing_of", {
        count: filteredReportedSkills?.length ?? 0,
        total: reportedSkills.length,
      })
    : t("management.loading_reports");

  const filteredUsers = userResult?.items ?? [];
  const userTotal = userResult?.total ?? 0;
  const userSummary = userResult
    ? t("management.showing_of", { count: filteredUsers.length, total: userTotal })
    : t("management.loading_users");
  const ownerUsers = ownerResult?.items ?? [];
  const selectedOwnerOption: ManagementOwnerOption | null = selectedSkill?.owner?.linkedUserId
    ? {
        userId: selectedSkill.owner.linkedUserId,
        label: `@${selectedSkill.owner.handle ?? selectedSkill.owner.displayName ?? "user"}`,
      }
    : null;
  const ownerUserOptions: ManagementOwnerOption[] = ownerUsers.map((user) => ({
    userId: user._id,
    label: formatManagementUserLabel(user, user._id, t),
  }));
  const ownerOptions =
    selectedOwnerOption &&
    !ownerUserOptions.some((option) => option.userId === selectedOwnerOption.userId)
      ? [selectedOwnerOption, ...ownerUserOptions]
      : ownerUserOptions;
  const ownerSummary = ownerResult
    ? t("management.showing_of", {
        count: ownerOptions.length,
        total: Math.max(ownerResult.total, ownerOptions.length),
      })
    : t("management.loading_owners");
  const userEmptyLabel = userResult
    ? filteredUsers.length === 0
      ? userQuery
        ? t("management.no_matching_users")
        : t("management.no_users")
      : ""
    : t("management.loading_users");

  const applySkillOverride = () => {
    if (!selectedSkill?.skill) return;
    void setSkillManualOverride({
      skillId: selectedSkill.skill._id,
      note: skillOverrideNote,
    })
      .then(() => {
        setSkillOverrideNote("");
        toast.success(t("management.skill_marked_okay"));
      })
      .catch((error) => toast.error(formatMutationError(error, t("management.request_failed"))));
  };

  const clearSkillOverride = () => {
    if (!selectedSkill?.skill?.manualOverride) return;
    void clearSkillManualOverride({
      skillId: selectedSkill.skill._id,
      note: skillOverrideNote,
    })
      .then(() => {
        setSkillOverrideNote("");
        toast.success(t("management.override_cleared"));
      })
      .catch((error) => toast.error(formatMutationError(error, t("management.request_failed"))));
  };

  const managePlugin = () => {
    const name = pluginSearch.trim();
    if (!name) return;
    void navigate({
      to: "/management",
      search: { view: "plugins", skill: undefined, plugin: name },
    });
  };
  const manageSkill = () => {
    const slug = skillSearch.trim();
    if (!slug) return;
    void navigate({
      to: "/management",
      search: { view: "skills", skill: slug, plugin: undefined },
    });
  };
  const requestBanUser = (userId: Id<"users">, label: string) => {
    setConfirmRequest({
      title: t("management.ban.title", { label }),
      body: t("management.ban.body"),
      confirmLabel: t("management.ban_user"),
      destructive: true,
      reason: {
        label: t("management.reason_optional"),
        placeholder: t("management.ban.placeholder"),
        maxLength: USER_BAN_REASON_MAX_LENGTH,
      },
      onConfirm: (reason) => {
        void banUser({ userId, reason })
          .then(() => toast.success(t("management.ban.success", { label })))
          .catch((error) =>
            toast.error(formatMutationError(error, t("management.request_failed"))),
          );
      },
    });
  };

  const requestUnbanUser = (userId: Id<"users">, label: string) => {
    setConfirmRequest({
      title: t("management.unban.title", { label }),
      body: t("management.unban.body"),
      confirmLabel: t("management.unban_user"),
      reason: {
        label: t("management.reason_optional"),
        placeholder: t("management.unban.placeholder"),
        maxLength: USER_BAN_REASON_MAX_LENGTH,
      },
      onConfirm: (reason) => {
        void unbanUser({ userId, reason })
          .then(() => toast.success(t("management.unban.success", { label })))
          .catch((error) =>
            toast.error(formatMutationError(error, t("management.request_failed"))),
          );
      },
    });
  };

  const requestToggleSkillHidden = (skill: Doc<"skills">) => {
    const hide = !skill.softDeletedAt;
    setConfirmRequest({
      title: hide
        ? t("management.skill.hide_title", { name: skill.displayName })
        : t("management.skill.restore_title", { name: skill.displayName }),
      confirmLabel: hide ? t("management.skill.hide_action") : t("management.skill.restore_action"),
      destructive: hide,
      reason: {
        label: t("management.reason"),
        placeholder: hide
          ? t("management.skill.hide_reason")
          : t("management.skill.restore_reason"),
        required: true,
      },
      onConfirm: (reason) => {
        void setSoftDeleted({
          skillId: skill._id,
          deleted: hide,
          reason: reason ?? "",
        })
          .then(() =>
            toast.success(hide ? t("management.skill.hidden") : t("management.skill.restored")),
          )
          .catch((error) =>
            toast.error(formatMutationError(error, t("management.request_failed"))),
          );
      },
    });
  };

  const requestHardDeleteSkill = (skill: Doc<"skills">) => {
    setConfirmRequest({
      title: t("management.skill.delete_title", { name: skill.displayName }),
      body: t("management.skill.delete_body"),
      confirmLabel: t("management.hard_delete"),
      destructive: true,
      onConfirm: () => {
        void hardDelete({ skillId: skill._id })
          .then(() => toast.success(t("management.skill.deleted")))
          .catch((error) =>
            toast.error(formatMutationError(error, t("management.request_failed"))),
          );
      },
    });
  };

  const banPublisherAbuseOwner = (item: PublisherAbuseReviewItem) => {
    const ownerUser = item.ownerUser;
    if (!ownerUser || !canBanPublisherAbuseOwner(item, me?._id ?? null, admin)) return;
    const label = `@${ownerUser.handle ?? ownerUser.name ?? item.nomination.handleSnapshot}`;
    // The review notes box above the Ban button is the ban reason — no separate prompt.
    const reason = publisherAbuseNotes.trim() || undefined;
    setConfirmRequest({
      title: t("management.ban.title", { label }),
      body: t("management.ban.body"),
      confirmLabel: t("management.ban_user"),
      destructive: true,
      onConfirm: () => {
        void banPublisherAbuseOwnerMutation({
          nominationId: item.nomination._id,
          expectedLatestScoreId: item.nomination.latestScoreId,
          expectedUpdatedAt: item.nomination.updatedAt,
          reason,
        })
          .then(() => {
            toast.success(t("management.ban.success", { label }));
            setPublisherAbuseNotes("");
            setSelectedPublisherAbuseNominationId(null);
          })
          .catch((error) =>
            toast.error(formatMutationError(error, t("management.request_failed"))),
          );
      },
    });
  };

  return (
    <main className="management-shell">
      <ManagementSidebar
        activeView={activeView}
        admin={admin}
        settlementStaff={settlementStaff}
        abuseCount={
          publisherAbuseDashboard
            ? getPublisherAbuseVisiblePendingItems(publisherAbuseDashboard).length
            : undefined
        }
        duplicateCount={duplicateCandidates?.length}
        recentCount={recentVersions?.length}
        reportCount={reportedSkills?.length}
        userCount={userResult ? userTotal : undefined}
      />
      <section className="management-main">
        <div className="management-breadcrumb">
          <span>{t("management.title")}</span>
          <ChevronRight size={13} aria-hidden="true" />
          <strong>{t(managementViewKey(activeView))}</strong>
        </div>

        {activeView === "abuse" ? (
          <AbusePage
            admin={admin}
            currentUserId={me?._id ?? null}
            dashboard={publisherAbuseDashboard}
            detail={selectedPublisherAbuseDetail}
            items={filteredPublisherAbuseItems}
            notes={publisherAbuseNotes}
            search={publisherAbuseSearch}
            selectedItem={selectedPublisherAbuseItem}
            selectedNominationId={selectedPublisherAbuseNominationId}
            tab={publisherAbuseTab}
            onBanOwner={banPublisherAbuseOwner}
            onChangeNotes={setPublisherAbuseNotes}
            onChangeSearch={setPublisherAbuseSearch}
            onChangeTab={setPublisherAbuseTab}
            onRefresh={() => {
              setConfirmRequest({
                title: t("management.abuse.scan_title"),
                body: t("management.abuse.scan_body"),
                confirmLabel: t("management.abuse.run_scan"),
                onConfirm: () => {
                  void startPublisherAbuseScoreRun({})
                    .then(() => toast.success(t("management.abuse.scan_started")))
                    .catch((error) =>
                      toast.error(formatMutationError(error, t("management.request_failed"))),
                    );
                },
              });
            }}
            onClose={() => setSelectedPublisherAbuseNominationId(null)}
            onSelect={setSelectedPublisherAbuseNominationId}
          />
        ) : null}

        {activeView === "reports" ? (
          <ReportsPage
            admin={admin}
            items={filteredReportedSkills}
            reportCountLabel={reportCountLabel}
            search={reportSearch}
            summary={reportSummary}
            onChangeSearch={setReportSearch}
            onHardDeleteSkill={requestHardDeleteSkill}
            onToggleSkillHidden={requestToggleSkillHidden}
          />
        ) : null}

        {activeView === "skills" ? (
          <SkillsPage
            admin={admin}
            currentUserId={me?._id ?? null}
            ownerOptions={ownerOptions}
            ownerSearch={ownerSearch}
            ownerSummary={ownerSummary}
            ownerUsers={ownerUsers}
            selectedDuplicate={selectedDuplicate}
            selectedOwner={selectedOwner}
            selectedSkill={selectedSkill}
            selectedSlug={selectedSlug}
            skillOverrideNote={skillOverrideNote}
            skillSearch={skillSearch}
            staff={staff}
            onApplySkillOverride={applySkillOverride}
            onBanUser={requestBanUser}
            onChangeOwner={(skillId, ownerUserId) => {
              void changeOwner({ skillId, ownerUserId });
            }}
            onChangeOwnerSearch={setOwnerSearch}
            onChangeSelectedDuplicate={setSelectedDuplicate}
            onChangeSelectedOwner={setSelectedOwner}
            onChangeSkillOverrideNote={setSkillOverrideNote}
            onChangeSkillSearch={setSkillSearch}
            onClearSkillOverride={clearSkillOverride}
            onHardDeleteSkill={requestHardDeleteSkill}
            onManageSkill={manageSkill}
            onSetBatch={(skillId, batch) => {
              void setBatch({ skillId, batch });
            }}
            onSetDeprecatedBadge={(skillId, deprecated) => {
              void setDeprecatedBadge({ skillId, deprecated });
            }}
            onSetDuplicate={(skillId, canonicalSlug) => {
              void setDuplicate({ skillId, canonicalSlug });
            }}
            onSetOfficialBadge={(skillId, official) => {
              void setOfficialBadge({ skillId, official });
            }}
            onToggleSkillHidden={requestToggleSkillHidden}
          />
        ) : null}

        {activeView === "plugins" ? (
          <PluginsPage
            pluginSearch={pluginSearch}
            selectedPlugin={selectedPlugin}
            selectedPluginName={selectedPluginName}
            onChangePluginSearch={setPluginSearch}
            onManagePlugin={managePlugin}
            onSetPackageBatch={(packageId, batch) => {
              void setPackageBatch({ packageId, batch }).catch((error) =>
                toast.error(formatMutationError(error, t("management.request_failed"))),
              );
            }}
          />
        ) : null}

        {activeView === "duplicates" ? (
          <DuplicatesPage
            duplicateCandidates={duplicateCandidates}
            onSetDuplicate={(skillId, canonicalSlug) => {
              void setDuplicate({ skillId, canonicalSlug });
            }}
          />
        ) : null}

        {activeView === "recent" ? <RecentPushesPage recentVersions={recentVersions} /> : null}

        {admin && activeView === "users" ? (
          <UsersPage
            currentUserId={me?._id ?? null}
            filteredUsers={filteredUsers}
            search={userSearch}
            summary={userSummary}
            userEmptyLabel={userEmptyLabel}
            onBanUser={requestBanUser}
            onChangeSearch={setUserSearch}
            onSetRole={(userId, role) => {
              void setRole({ userId, role });
            }}
            onUnbanUser={requestUnbanUser}
          />
        ) : null}
        {!admin && activeView === "users" ? (
          <ManagementPlaceholder
            title={t("management.users")}
            description={t("management.placeholder.users")}
          />
        ) : null}
        {activeView === "overview" ? <ManagementInsightsPage view="overview" /> : null}
        {activeView === "employees" ? <ManagementInsightsPage view="employees" /> : null}
        {activeView === "costs" ? <ManagementInsightsPage view="costs" /> : null}
        {activeView === "publishers" ? (
          <ManagementPlaceholder
            title={t("management.publishers")}
            description={t("management.placeholder.publishers")}
          />
        ) : null}
        {activeView === "organizations" ? <OrganizationAdminPage /> : null}
        {settlementStaff && activeView === "wallets" ? <WalletOperationsPage /> : null}
        {settlementStaff && activeView === "settlements" ? (
          <SettlementOperationsPage onStaffAccessChange={setSettlementStaff} />
        ) : null}
        {activeView === "templates" ? <TemplateReviewPage /> : null}
        {activeView === "audit" ? <AuditCenterPage /> : null}
        {activeView === "approvals" ? <ApprovalCenterPage /> : null}
        {activeView === "system" ? <ManagementInsightsPage view="system" /> : null}
        {admin && activeView === "friendly-links" ? <FriendlyLinksPage /> : null}
        {!admin && activeView === "friendly-links" ? (
          <ManagementPlaceholder
            title={t("management.friendly_links")}
            description={t("management.placeholder.friendly_links")}
          />
        ) : null}
        {activeView === "settings" ? (
          <ManagementPlaceholder
            title={t("management.settings")}
            description={t("management.placeholder.settings")}
          />
        ) : null}
      </section>
      <ManagementConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </main>
  );
}

function ManagementPlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <Card className="management-placeholder">
      <h2 className="section-title text-[1.2rem] m-0">{title}</h2>
      <p className="section-subtitle m-0">{description}</p>
    </Card>
  );
}

function ManagementSidebar({
  abuseCount,
  activeView,
  admin,
  settlementStaff,
  duplicateCount,
  recentCount,
  reportCount,
  userCount,
}: {
  abuseCount?: number;
  activeView: ManagementView;
  admin: boolean;
  settlementStaff: boolean;
  duplicateCount?: number;
  recentCount?: number;
  reportCount?: number;
  userCount?: number;
}) {
  const { locale, t } = useLocale();
  return (
    <aside className="management-sidebar">
      <nav aria-label={t("management.sections")}>
        <div className="management-sidebar-heading">{t("management.title")}</div>
        <div className="management-sidebar-section-title">{t("management.operations")}</div>
        <div className="management-sidebar-group">
          <ManagementSidebarLink
            active={activeView === "overview"}
            icon={<ClipboardList size={15} />}
            label={t("management.overview")}
            view="overview"
          />
          <ManagementSidebarLink
            active={activeView === "system"}
            icon={<ShieldCheck size={15} />}
            label={t("management.system_status")}
            view="system"
          />
          <ManagementSidebarLink
            active={activeView === "employees"}
            icon={<UserRound size={15} />}
            label={t("management.employee_directory")}
            view="employees"
          />
          <ManagementSidebarLink
            active={activeView === "costs"}
            icon={<FileCheck2 size={15} />}
            label={t("management.cost_ledger")}
            view="costs"
          />
          <ManagementSidebarLink
            active={activeView === "approvals"}
            icon={<ShieldCheck size={15} />}
            label={t("management.approval_center")}
            view="approvals"
          />
        </div>
        <div className="management-sidebar-section-title">{t("management.review")}</div>
        <div className="management-sidebar-group">
          <ManagementSidebarLink
            active={activeView === "abuse"}
            badge={queueBadge(abuseCount)}
            icon={<AlertTriangle size={15} />}
            label={t("management.publisher_abuse")}
            view="abuse"
          />
          <ManagementSidebarLink
            active={activeView === "reports"}
            badge={queueBadge(reportCount)}
            icon={<ClipboardList size={15} />}
            label={t("management.content_reports")}
            view="reports"
          />
        </div>

        <div className="management-sidebar-section-title">{t("management.queues")}</div>
        <div className="management-sidebar-group">
          <ManagementSidebarLink
            active={activeView === "duplicates"}
            badge={queueBadge(duplicateCount)}
            icon={<PackageSearch size={15} />}
            label={t("management.duplicate_candidates")}
            view="duplicates"
          />
          <ManagementSidebarLink
            active={activeView === "recent"}
            badge={queueBadge(recentCount)}
            icon={<GitBranch size={15} />}
            label={t("management.recent_pushes")}
            view="recent"
          />
        </div>

        <div className="management-sidebar-section-title">{t("management.ai_direct")}</div>
        <div className="management-sidebar-group">
          <ManagementSidebarLink
            active={activeView === "organizations"}
            icon={<Building2 size={15} />}
            label={t("management.organizations")}
            view="organizations"
          />
          {admin ? (
            <ManagementSidebarLink
              active={activeView === "templates"}
              icon={<FileCheck2 size={15} />}
              label={t("management.template_review")}
              view="templates"
            />
          ) : null}
          {settlementStaff ? (
            <>
              <ManagementSidebarLink
                active={activeView === "wallets"}
                icon={<WalletCards size={15} />}
                label={t("management.wallets")}
                view="wallets"
              />
              <ManagementSidebarLink
                active={activeView === "settlements"}
                icon={<FileCheck2 size={15} />}
                label={t("management.settlements")}
                view="settlements"
              />
            </>
          ) : null}
          <ManagementSidebarLink
            active={activeView === "audit"}
            icon={<ShieldCheck size={15} />}
            label={t("management.audit_log")}
            view="audit"
          />
        </div>

        <div className="management-sidebar-section-title">{t("management.staff_tools")}</div>
        <div className="management-sidebar-group">
          {admin ? (
            <>
              <ManagementSidebarLink
                active={activeView === "users"}
                badge={userCount === undefined ? undefined : formatWholeNumber(userCount, locale)}
                icon={<UserRound size={15} />}
                label={t("management.users")}
                view="users"
              />
              <ManagementSidebarLink
                active={activeView === "friendly-links"}
                icon={<Link2 size={15} />}
                label={t("management.friendly_links")}
                view="friendly-links"
              />
            </>
          ) : null}
          <ManagementSidebarLink
            active={activeView === "skills"}
            icon={<Wrench size={15} />}
            label={t("management.skills")}
            view="skills"
          />
          <ManagementSidebarLink
            active={activeView === "plugins"}
            icon={<Plug size={15} />}
            label={t("management.plugins")}
            view="plugins"
          />
        </div>
      </nav>
    </aside>
  );
}

function ManagementSidebarLink({
  active,
  badge,
  icon,
  label,
  view,
}: {
  active: boolean;
  badge?: string;
  icon: ReactNode;
  label: string;
  view: ManagementView;
}) {
  return (
    <Link
      className={active ? "management-sidebar-link is-active" : "management-sidebar-link"}
      to="/management"
      search={{ view, skill: undefined, plugin: undefined }}
    >
      {icon}
      <span>{label}</span>
      {badge ? <small>{badge}</small> : null}
    </Link>
  );
}

function resolveManagementView(
  view: ManagementView | undefined,
  selectedSlug?: string,
  selectedPluginName?: string,
): ManagementView {
  if (selectedSlug) return "skills";
  if (selectedPluginName) return "plugins";
  return view ?? "abuse";
}

const MANAGEMENT_VIEW_KEYS: Record<ManagementView, TranslationKey> = {
  overview: "management.overview",
  abuse: "management.publisher_abuse",
  reports: "management.content_reports",
  users: "management.users",
  publishers: "management.publishers",
  skills: "management.skills",
  plugins: "management.plugins",
  duplicates: "management.duplicate_candidates",
  recent: "management.recent_pushes",
  organizations: "management.organizations",
  templates: "management.template_review",
  wallets: "management.wallets",
  settlements: "management.settlements",
  audit: "management.audit_log",
  system: "management.system",
  employees: "management.employee_directory",
  costs: "management.cost_ledger",
  approvals: "management.approval_center",
  "friendly-links": "management.friendly_links",
  settings: "management.settings",
};

function managementViewKey(view: ManagementView) {
  return MANAGEMENT_VIEW_KEYS[view];
}

/** Queue badges only carry signal when there is a backlog; hide 0 and loading. */
function queueBadge(count: number | undefined) {
  return count ? formatWholeNumber(count) : undefined;
}
