import { Link } from "@tanstack/react-router";
import { Ban, Copy, ExternalLink, RefreshCcw, Search } from "lucide-react";
import type { Id } from "../../../convex/_generated/dataModel";
import { Badge, type BadgeProps } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../components/ui/sheet";
import { Textarea } from "../../components/ui/textarea";
import type { Locale } from "../../lib/i18n/config";
import { useLocale } from "../../lib/i18n/context";
import {
  formatRatio,
  formatScore,
  formatShortTimestamp,
  formatWholeNumber,
  type PublisherAbuseReviewDashboard,
  type ManagementTranslator,
  type PublisherAbuseReviewDetail,
  type PublisherAbuseReviewItem,
  type PublisherAbuseReviewScore,
  type PublisherAbuseTab,
  USER_BAN_REASON_MAX_LENGTH,
} from "./managementShared";

export function AbusePage({
  admin,
  currentUserId,
  dashboard,
  detail,
  items,
  notes,
  search,
  selectedItem,
  selectedNominationId,
  tab,
  onBanOwner,
  onChangeNotes,
  onChangeSearch,
  onChangeTab,
  onClose,
  onRefresh,
  onSelect,
}: {
  admin: boolean;
  currentUserId: Id<"users"> | null;
  dashboard: PublisherAbuseReviewDashboard | undefined;
  detail: PublisherAbuseReviewDetail | undefined;
  items: PublisherAbuseReviewItem[];
  notes: string;
  search: string;
  selectedItem: PublisherAbuseReviewItem | null;
  selectedNominationId: Id<"publisherAbuseReviewNominations"> | null;
  tab: PublisherAbuseTab;
  onBanOwner: (item: PublisherAbuseReviewItem) => void;
  onChangeNotes: (value: string) => void;
  onChangeSearch: (value: string) => void;
  onChangeTab: (value: PublisherAbuseTab) => void;
  onClose: () => void;
  onRefresh: () => void;
  onSelect: (value: Id<"publisherAbuseReviewNominations">) => void;
}) {
  const { locale, t } = useLocale();
  const latestRun = dashboard?.latestRun ?? null;
  const selectedScore = selectedItem?.latestScore ?? null;
  const selectedPublisher = selectedItem?.publisher ?? null;
  const canBanSelectedUser = canBanPublisherAbuseOwner(selectedItem, currentUserId, admin);
  const visiblePending = dashboard ? getPublisherAbuseVisiblePendingItems(dashboard) : [];
  const totalPending = visiblePending.length;
  const potentialBan = visiblePending.filter(
    (item) => item.nomination.label === "potential_ban_candidate",
  ).length;
  const review = visiblePending.filter((item) => item.nomination.label === "review").length;
  const resolved = dashboard?.recentResolvedItems.length ?? 0;
  const totalForTab =
    tab === "potential_ban_candidate"
      ? potentialBan
      : tab === "review"
        ? review
        : tab === "resolved"
          ? resolved
          : totalPending;
  const loaded = dashboard !== undefined;

  return (
    <section className="pa" aria-labelledby="pa-title">
      <header className="pa-head">
        <div>
          <h2 id="pa-title" className="section-title pa-title">
            {t("management.abuse.title")}
          </h2>
          <p className="section-subtitle pa-subtitle">{t("management.abuse.subtitle")}</p>
        </div>
        <div className="pa-run">
          <dl className="pa-run-meta">
            <div>
              <dt>{t("management.abuse.last_scan")}</dt>
              <dd
                className={
                  latestRun?.status === "completed"
                    ? "pa-run-ok"
                    : latestRun?.status === "failed"
                      ? "pa-run-bad"
                      : undefined
                }
              >
                {latestRun
                  ? formatPublisherAbuseRunStatus(latestRun.status, t)
                  : loaded
                    ? t("management.abuse.no_scans")
                    : t("management.abuse.loading")}
              </dd>
            </div>
            <div>
              <dt>{t("management.abuse.scanned")}</dt>
              <dd>{formatWholeNumber(latestRun?.scannedPublishers, locale)}</dd>
            </div>
            <div>
              <dt>{t("management.abuse.scored")}</dt>
              <dd>{formatWholeNumber(latestRun?.scoredPublishers, locale)}</dd>
            </div>
          </dl>
          <div className="pa-rescan">
            <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
              <RefreshCcw size={14} />
              {t("management.abuse.run_new")}
            </Button>
            <span className="pa-rescan-hint">{t("management.abuse.rescores_all")}</span>
          </div>
        </div>
      </header>

      <div className="pa-tabs" role="tablist" aria-label={t("management.abuse.queue")}>
        <PublisherAbuseTabButton
          active={tab === "potential_ban_candidate"}
          count={loaded ? potentialBan : undefined}
          label={t("management.abuse.potential_ban")}
          locale={locale}
          loadingLabel={t("management.abuse.loading")}
          onClick={() => onChangeTab("potential_ban_candidate")}
        />
        <PublisherAbuseTabButton
          active={tab === "review"}
          count={loaded ? review : undefined}
          label={t("management.abuse.on_brink")}
          locale={locale}
          loadingLabel={t("management.abuse.loading")}
          onClick={() => onChangeTab("review")}
        />
        <PublisherAbuseTabButton
          active={tab === "all_pending"}
          count={loaded ? totalPending : undefined}
          label={t("management.abuse.all_flagged")}
          locale={locale}
          loadingLabel={t("management.abuse.loading")}
          onClick={() => onChangeTab("all_pending")}
        />
        <PublisherAbuseTabButton
          active={tab === "resolved"}
          count={loaded ? resolved : undefined}
          label={t("management.abuse.resolved")}
          locale={locale}
          loadingLabel={t("management.abuse.loading")}
          onClick={() => onChangeTab("resolved")}
        />
      </div>

      <Card className="pa-queue">
        <label className="pa-search">
          <Search size={16} />
          <input
            type="search"
            placeholder={t("management.abuse.search")}
            value={search}
            onChange={(event) => onChangeSearch(event.target.value)}
          />
        </label>
        <div className="pa-table-wrap">
          <table className="pa-table">
            <thead>
              <tr>
                <th>{t("management.abuse.label")}</th>
                <th>{t("management.abuse.handle")}</th>
                <th className="pa-num">Z-score</th>
                <th>{t("management.abuse.reasons")}</th>
                <th>{t("management.abuse.last_scored")}</th>
              </tr>
            </thead>
            <tbody>
              {!loaded ? (
                <tr>
                  <td colSpan={5}>{t("management.abuse.loading_nominations")}</td>
                </tr>
              ) : items.length === 0 ? (
                <tr className="pa-empty-row">
                  <td colSpan={5}>
                    <strong>{t("management.abuse.queue_clear")}</strong>
                    {t("management.abuse.queue_empty")}
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const score = item.latestScore;
                  const selected = item.nomination._id === selectedNominationId;
                  return (
                    <tr
                      key={item.nomination._id}
                      className={selected ? "is-selected" : undefined}
                      onClick={() => onSelect(item.nomination._id)}
                    >
                      <td>
                        <Badge
                          variant={publisherAbuseLabelVariant(item.nomination.label)}
                          size="sm"
                        >
                          {formatPublisherAbuseLabel(item.nomination.label, t)}
                        </Badge>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="pa-handle pa-row-button"
                          aria-label={t("management.abuse.open_details", {
                            handle: item.nomination.handleSnapshot,
                          })}
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelect(item.nomination._id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            event.currentTarget.click();
                          }}
                        >
                          <strong>{item.nomination.handleSnapshot}</strong>
                          <span>{compactIdentifier(item.nomination.ownerKey)}</span>
                        </button>
                      </td>
                      <td className={`pa-num ${score ? zScoreClass(score.zScore) : ""}`}>
                        {score ? formatScore(score.zScore, locale) : "—"}
                      </td>
                      <td>
                        <div className="pa-reasons">
                          {(score?.reasonCodes ?? []).slice(0, 2).map((reason) => (
                            <Badge key={reason} variant="compact">
                              {formatReasonCode(reason, t)}
                            </Badge>
                          ))}
                          {(score?.reasonCodes.length ?? 0) > 2 ? (
                            <Badge variant="compact">+{(score?.reasonCodes.length ?? 0) - 2}</Badge>
                          ) : null}
                          {!score?.reasonCodes.length ? <span className="pa-muted">—</span> : null}
                        </div>
                      </td>
                      <td className="pa-muted">
                        {formatShortTimestamp(item.nomination.lastScoredAt, locale)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="pa-foot">
          {loaded
            ? t("management.abuse.showing_nominations", {
                count: formatWholeNumber(items.length, locale),
                total: formatWholeNumber(totalForTab, locale),
              })
            : `${t("management.abuse.loading")}…`}
        </div>
      </Card>

      <Sheet
        open={selectedItem !== null}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <SheetContent side="right" className="pa-sheet w-[600px] max-w-[92vw]">
          {selectedItem ? (
            <>
              <SheetHeader className="pa-sheet-head">
                <SheetTitle>{selectedItem.nomination.handleSnapshot}</SheetTitle>
                <SheetDescription className="sr-only">
                  {t("management.abuse.details_desc")}
                </SheetDescription>
                <div className="pa-pills">
                  <Badge
                    variant={publisherAbuseLabelVariant(selectedItem.nomination.label)}
                    size="sm"
                  >
                    {formatPublisherAbuseLabel(selectedItem.nomination.label, t)}
                  </Badge>
                </div>
                <div className="pa-idline">
                  <PublisherAbuseIdentity
                    label={t("management.abuse.publisher")}
                    value={
                      selectedItem.nomination.ownerPublisherId ?? selectedItem.nomination.ownerKey
                    }
                  />
                  <PublisherAbuseIdentity
                    label={t("management.abuse.user")}
                    value={
                      selectedItem.nomination.ownerUserId ?? t("management.abuse.no_linked_user")
                    }
                  />
                  {selectedPublisher ? (
                    <Link
                      className="pa-profile-link"
                      to="/p/$handle"
                      params={{ handle: selectedPublisher.handle }}
                    >
                      <ExternalLink size={12} />
                      {t("management.abuse.profile")}
                    </Link>
                  ) : null}
                </div>
              </SheetHeader>

              <div className="pa-sheet-body">
                <div className="pa-score">
                  <div>
                    <span>Z-score</span>
                    <strong
                      className={selectedScore ? zScoreClass(selectedScore.zScore) : undefined}
                    >
                      {selectedScore ? formatScore(selectedScore.zScore, locale) : "—"}
                    </strong>
                  </div>
                  <div>
                    <span>{t("management.abuse.rank")}</span>
                    <strong>
                      {selectedScore ? formatWholeNumber(selectedScore.rank, locale) : "—"}
                    </strong>
                    <small>
                      {t("management.abuse.rank_of", {
                        total: formatWholeNumber(latestRunScoredCount(detail, dashboard), locale),
                      })}
                    </small>
                  </div>
                  <div>
                    <span>{t("management.abuse.pressure")}</span>
                    <strong>{selectedScore ? formatPressureLabel(selectedScore, t) : "—"}</strong>
                  </div>
                </div>

                <section className="pa-zone">
                  <div className="pa-section-label">{t("management.abuse.why_flagged")}</div>
                  <div className="pa-reason-list">
                    {(selectedScore?.reasonCodes ?? []).map((reason) => (
                      <div key={reason} className="pa-reason">
                        <strong>{formatReasonCode(reason, t)}</strong>
                        <small>{describeReasonCode(reason, t)}</small>
                      </div>
                    ))}
                    {!selectedScore?.reasonCodes.length ? (
                      <div className="pa-reason">
                        <strong>{t("management.abuse.no_reason")}</strong>
                        <small>{t("management.abuse.no_reason_desc")}</small>
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className="pa-zone">
                  <div className="pa-section-label">{t("management.abuse.publisher_activity")}</div>
                  <div className="pa-metrics">
                    <PublisherAbuseMetric
                      label={t("management.abuse.published_skills")}
                      locale={locale}
                      value={selectedScore?.publishedSkills}
                    />
                    <PublisherAbuseMetric
                      label={t("management.abuse.total_installs")}
                      locale={locale}
                      value={selectedScore?.totalInstalls}
                    />
                    <PublisherAbuseMetric
                      label={t("management.abuse.total_stars")}
                      locale={locale}
                      value={selectedScore?.totalStars}
                    />
                    <PublisherAbuseMetric
                      label={t("management.abuse.total_downloads")}
                      locale={locale}
                      value={selectedScore?.totalDownloads}
                    />
                  </div>
                  <div className="pa-metrics pa-metrics-ratios">
                    <PublisherAbuseMetric
                      label={t("management.abuse.installs_per_skill")}
                      locale={locale}
                      value={selectedScore?.installsPerSkill}
                      ratio
                    />
                    <PublisherAbuseMetric
                      label={t("management.abuse.stars_per_skill")}
                      locale={locale}
                      value={selectedScore?.starsPerSkill}
                      ratio
                    />
                    <PublisherAbuseMetric
                      label={t("management.abuse.downloads_per_skill")}
                      locale={locale}
                      value={selectedScore?.downloadsPerSkill}
                      ratio
                    />
                  </div>
                  <PublisherTemporalEvidence score={selectedScore} />
                </section>

                {detail?.scoreHistory.length ? (
                  <section className="pa-zone">
                    <div className="pa-section-label">{t("management.abuse.scoring_history")}</div>
                    <div className="pa-history">
                      {detail.scoreHistory.map((score) => (
                        <div key={score._id} className="pa-history-item">
                          <span>{formatShortTimestamp(score.createdAt, locale)}</span>
                          <strong className={zScoreClass(score.zScore)}>
                            {formatScore(score.zScore, locale)}
                          </strong>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {selectedItem.nomination.status !== "pending" ? (
                  <section className="pa-zone pa-review">
                    <div className="pa-section-label">{t("management.abuse.resolution")}</div>
                    <div className="pa-actions">
                      <Badge variant={publisherAbuseStatusVariant(selectedItem.nomination.status)}>
                        {formatPublisherAbuseStatus(selectedItem.nomination.status, t)}
                      </Badge>
                      <span className="pa-muted">
                        {t("management.abuse.reviewed_at", {
                          time: formatShortTimestamp(
                            selectedItem.nomination.reviewedAt ?? selectedItem.nomination.updatedAt,
                            locale,
                          ),
                        })}
                      </span>
                    </div>
                    <p className="pa-hint">
                      {selectedItem.nomination.notes?.trim() ||
                        t("management.abuse.no_longer_pending")}
                    </p>
                  </section>
                ) : selectedItem.nomination.label === "potential_ban_candidate" ? (
                  <section className="pa-zone pa-review">
                    <div className="pa-section-label">{t("management.abuse.triage_note")}</div>
                    <Textarea
                      maxLength={USER_BAN_REASON_MAX_LENGTH}
                      placeholder={t("management.abuse.action_placeholder")}
                      value={notes}
                      onChange={(event) => onChangeNotes(event.target.value)}
                    />
                    <div className="pa-actions">
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="pa-ban"
                        disabled={!canBanSelectedUser}
                        onClick={() => onBanOwner(selectedItem)}
                      >
                        <Ban size={14} />
                        {t("management.ban_user")}
                      </Button>
                    </div>
                  </section>
                ) : (
                  <section className="pa-zone pa-review">
                    <div className="pa-section-label">{t("management.abuse.calibration")}</div>
                    <p className="pa-hint">{t("management.abuse.calibration_desc")}</p>
                  </section>
                )}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </section>
  );
}

function PublisherAbuseTabButton({
  active,
  count,
  label,
  locale,
  loadingLabel,
  onClick,
}: {
  active: boolean;
  count: number | undefined;
  label: string;
  locale: Locale;
  loadingLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={active ? "pa-tab is-active" : "pa-tab"}
      onClick={onClick}
    >
      {label}{" "}
      {count === undefined ? (
        <span className="pa-tab-count pa-count-loading" aria-label={loadingLabel} />
      ) : (
        <span className="pa-tab-count">{formatWholeNumber(count, locale)}</span>
      )}
    </button>
  );
}

function PublisherAbuseIdentity({ label, value }: { label: string; value: string }) {
  return (
    <div className="pa-id">
      <span className="pa-id-label">{label}</span>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(value);
        }}
      >
        {compactIdentifier(value)}
        <Copy size={12} />
      </button>
    </div>
  );
}

function PublisherAbuseMetric({
  label,
  locale,
  ratio,
  value,
}: {
  label: string;
  locale?: Locale;
  ratio?: boolean;
  value?: number;
}) {
  return (
    <div className="pa-metric">
      <span>{label}</span>
      <strong>{ratio ? formatRatio(value, locale) : formatWholeNumber(value, locale)}</strong>
    </div>
  );
}

function PublisherTemporalEvidence({ score }: { score: PublisherAbuseReviewScore | null }) {
  const { locale, t } = useLocale();
  const evidence = score?.temporalEvidence ?? [];
  if (!evidence.length) return null;

  const benchmark = score?.temporalBenchmark;
  return (
    <div className="pa-activity-evidence">
      <div className="pa-subsection-label">{t("management.abuse.temporal_signal")}</div>
      {benchmark ? (
        <p className="pa-hint">
          {t("management.abuse.temporal_benchmark", {
            count: formatWholeNumber(benchmark.sampleSize, locale),
            p95: formatWholeNumber(benchmark.downloads30dP95, locale),
            p99: formatWholeNumber(benchmark.downloads30dP99, locale),
          })}
        </p>
      ) : null}
      <div className="pa-temporal-list">
        {evidence.map((item) => (
          <div key={`${item.skillId}:${item.slug}`} className="pa-temporal-card">
            <div className="pa-temporal-head">
              <div>
                <strong>{item.displayName}</strong>
                <small>{item.slug}</small>
              </div>
              <div className="pa-temporal-badges">
                {item.downloads30dCohortBand ? (
                  <Badge variant="compact">{item.downloads30dCohortBand.toUpperCase()} 30d</Badge>
                ) : null}
                {item.spikeMultiplierCohortBand ? (
                  <Badge variant="compact">
                    {item.spikeMultiplierCohortBand.toUpperCase()} spike
                  </Badge>
                ) : null}
              </div>
            </div>
            <div className="pa-temporal-metrics">
              <PublisherAbuseMetric
                label={t("management.abuse.downloads_30d")}
                locale={locale}
                value={item.recent30Downloads}
              />
              {benchmark ? (
                <PublisherAbuseMetric
                  label={t("management.abuse.peer_30d_p95")}
                  locale={locale}
                  value={benchmark.downloads30dP95}
                />
              ) : null}
              {benchmark ? (
                <PublisherAbuseMetric
                  label={t("management.abuse.peer_30d_p99")}
                  locale={locale}
                  value={benchmark.downloads30dP99}
                />
              ) : null}
              <PublisherAbuseMetric
                label={t("management.abuse.vs_p95_30d")}
                locale={locale}
                value={item.downloads30dVsPeerP95}
                ratio
              />
              <PublisherAbuseMetric
                label={t("management.abuse.spike_7d")}
                locale={locale}
                value={item.spikeMultiplier}
                ratio
              />
              {benchmark ? (
                <PublisherAbuseMetric
                  label={t("management.abuse.peer_spike_p95")}
                  locale={locale}
                  value={benchmark.spikeMultiplier7dP95}
                  ratio
                />
              ) : null}
              <PublisherAbuseMetric
                label={t("management.abuse.spike_vs_p95")}
                locale={locale}
                value={item.spikeMultiplierVsPeerP95}
                ratio
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function publisherAbuseLabelVariant(label: string) {
  if (label === "potential_ban_candidate") return "destructive" as const;
  if (label === "review") return "review" as const;
  return "success" as const;
}

function isVisiblePublisherAbuseItem(item: PublisherAbuseReviewItem) {
  return (
    item.nomination.label !== "pass" &&
    !item.ownerUser?.deletedAt &&
    !item.ownerUser?.deactivatedAt &&
    !item.publisher?.deletedAt &&
    !item.publisher?.deactivatedAt
  );
}

export function canBanPublisherAbuseOwner(
  item: PublisherAbuseReviewItem | null,
  currentUserId: Id<"users"> | null,
  admin: boolean,
) {
  const ownerUser = item?.ownerUser;
  if (!ownerUser?._id) return false;
  if (ownerUser._id === currentUserId) return false;
  if (ownerUser.role === "admin" && !admin) return false;
  return true;
}

export function getPublisherAbuseVisiblePendingItems(dashboard: PublisherAbuseReviewDashboard) {
  return [...dashboard.pendingPotentialBanCandidateItems, ...dashboard.pendingReviewItems].filter(
    isVisiblePublisherAbuseItem,
  );
}

export function getPublisherAbuseItemsForTab(
  dashboard: PublisherAbuseReviewDashboard,
  tab: PublisherAbuseTab,
) {
  if (tab === "potential_ban_candidate") {
    return dashboard.pendingPotentialBanCandidateItems.filter(isVisiblePublisherAbuseItem);
  }
  if (tab === "review") return dashboard.pendingReviewItems.filter(isVisiblePublisherAbuseItem);
  if (tab === "resolved") return dashboard.recentResolvedItems;
  return getPublisherAbuseVisiblePendingItems(dashboard);
}

export function filterPublisherAbuseItems(items: PublisherAbuseReviewItem[], search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return items;
  return items.filter((item) => {
    const score = item.latestScore;
    const haystack = [
      item.nomination.handleSnapshot,
      item.nomination.ownerKey,
      item.nomination.ownerPublisherId,
      item.nomination.ownerUserId,
      item.ownerUser?.handle,
      item.ownerUser?.name,
      item.ownerUser?.displayName,
      item.publisher?.displayName,
      item.publisher?.handle,
      item.nomination.label,
      item.nomination.status,
      ...(score?.reasonCodes ?? []),
    ]
      .filter((value) => typeof value === "string" && value.length > 0)
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

export function comparePublisherAbuseItems(
  left: PublisherAbuseReviewItem,
  right: PublisherAbuseReviewItem,
) {
  const leftScore = left.latestScore?.zScore ?? Number.NEGATIVE_INFINITY;
  const rightScore = right.latestScore?.zScore ?? Number.NEGATIVE_INFINITY;
  if (leftScore !== rightScore) return rightScore - leftScore;
  return right.nomination.lastScoredAt - left.nomination.lastScoredAt;
}

function latestRunScoredCount(
  detail: PublisherAbuseReviewDetail | undefined,
  dashboard: PublisherAbuseReviewDashboard | undefined,
) {
  return (
    detail?.latestScoreRun?.scoredPublishers ??
    detail?.item.openedByRun?.scoredPublishers ??
    dashboard?.latestRun?.scoredPublishers
  );
}

function formatPublisherAbuseRunStatus(status: string, t: ManagementTranslator) {
  if (status === "completed") return t("management.abuse.status.completed");
  if (status === "running") return t("management.abuse.status.running");
  if (status === "failed") return t("management.abuse.status.failed");
  return status;
}

function formatPublisherAbuseLabel(label: string, t: ManagementTranslator) {
  if (label === "potential_ban_candidate") return t("management.abuse.potential_ban");
  if (label === "review") return t("management.abuse.on_brink");
  if (label === "pass") return t("management.abuse.status.pass");
  return label;
}

function formatPublisherAbuseStatus(status: string, t: ManagementTranslator) {
  if (status === "pending") return t("management.abuse.status.pending");
  if (status === "banned") return t("management.abuse.status.banned");
  if (status === "reviewed_no_action") return t("management.abuse.status.reviewed");
  if (status === "false_positive") return t("management.abuse.status.false_positive");
  if (status === "needs_policy_discussion") return t("management.abuse.status.needs_discussion");
  if (status === "candidate_for_future_action") return t("management.abuse.status.future_action");
  return status;
}

function publisherAbuseStatusVariant(status: string): NonNullable<BadgeProps["variant"]> {
  if (status === "banned") return "destructive";
  if (status === "false_positive" || status === "reviewed_no_action") return "success";
  if (status === "needs_policy_discussion" || status === "candidate_for_future_action") {
    return "warning";
  }
  return "default";
}

const PUBLISHER_ABUSE_REASON_KEYS = {
  high_catalog_volume: {
    label: "management.abuse.reason.high_catalog_volume",
    description: "management.abuse.reason_desc.high_catalog_volume",
  },
  extreme_volume_low_engagement: {
    label: "management.abuse.reason.extreme_volume_low_engagement",
    description: "management.abuse.reason_desc.extreme_volume_low_engagement",
  },
  low_installs_per_skill: {
    label: "management.abuse.reason.low_installs_per_skill",
    description: "management.abuse.reason_desc.low_installs_per_skill",
  },
  low_stars_per_skill: {
    label: "management.abuse.reason.low_stars_per_skill",
    description: "management.abuse.reason_desc.low_stars_per_skill",
  },
  low_downloads_per_skill: {
    label: "management.abuse.reason.low_downloads_per_skill",
    description: "management.abuse.reason_desc.low_downloads_per_skill",
  },
  temporal_download_spike_flat_installs: {
    label: "management.abuse.reason.temporal_download_spike_flat_installs",
    description: "management.abuse.reason_desc.temporal_download_spike_flat_installs",
  },
  temporal_sustained_downloads_flat_installs: {
    label: "management.abuse.reason.temporal_sustained_downloads_flat_installs",
    description: "management.abuse.reason_desc.temporal_sustained_downloads_flat_installs",
  },
} as const;

function getPublisherAbuseReasonKey(reason: string) {
  return Object.hasOwn(PUBLISHER_ABUSE_REASON_KEYS, reason)
    ? (reason as keyof typeof PUBLISHER_ABUSE_REASON_KEYS)
    : null;
}

function formatReasonCode(reason: string, t: ManagementTranslator) {
  const key = getPublisherAbuseReasonKey(reason);
  return key ? t(PUBLISHER_ABUSE_REASON_KEYS[key].label) : reason.replaceAll("_", " ");
}

function describeReasonCode(reason: string, t: ManagementTranslator) {
  const key = getPublisherAbuseReasonKey(reason);
  return key
    ? t(PUBLISHER_ABUSE_REASON_KEYS[key].description)
    : t("management.abuse.reason.default");
}

function compactIdentifier(value: string) {
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function zScoreClass(value: number) {
  if (value >= 2.5) return "pa-z-danger";
  if (value >= 1.5) return "pa-z-warn";
  return "pa-z-ok";
}

function formatPressureLabel(
  score: Pick<PublisherAbuseReviewScore, "zScore">,
  t: ManagementTranslator,
) {
  if (score.zScore >= 2.5) return t("management.abuse.pressure.very_high");
  if (score.zScore >= 1.5) return t("management.abuse.pressure.high");
  if (score.zScore >= 0.5) return t("management.abuse.pressure.elevated");
  return t("management.abuse.pressure.low");
}
