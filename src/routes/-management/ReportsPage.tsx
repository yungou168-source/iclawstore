import { Link } from "@tanstack/react-router";
import type { Doc } from "../../../convex/_generated/dataModel";
import { Button } from "../../components/ui/button";
import { useLocale } from "../../lib/i18n/context";
import { formatTimestamp, resolveOwnerParam, type ReportedSkillEntry } from "./managementShared";

export function ReportsPage({
  admin,
  items,
  reportCountLabel,
  search,
  summary,
  onChangeSearch,
  onHardDeleteSkill,
  onToggleSkillHidden,
}: {
  admin: boolean;
  items: ReportedSkillEntry[] | undefined;
  reportCountLabel: string;
  search: string;
  summary: string;
  onChangeSearch: (value: string) => void;
  onHardDeleteSkill: (skill: Doc<"skills">) => void;
  onToggleSkillHidden: (skill: Doc<"skills">) => void;
}) {
  const { locale, t } = useLocale();
  return (
    <div className="management-view">
      <h2 className="section-title text-[1.2rem] m-0">{t("management.reports.title")}</h2>
      <p className="section-subtitle m-0 mt-1">
        {t("management.reports.subtitle")}
      </p>
      <div className="management-controls">
        <div className="management-control management-search">
          <span className="mono">{t("management.filter")}</span>
          <input
            type="search"
            placeholder={t("management.reports.search")}
            value={search}
            onChange={(event) => onChangeSearch(event.target.value)}
          />
        </div>
        <div className="management-count">{summary}</div>
      </div>
      <div className="management-list">
        {!items ? (
          <div className="management-empty">{t("management.loading_reports")}</div>
        ) : items.length === 0 ? (
          <div className="management-empty">{reportCountLabel}</div>
        ) : (
          items.map((entry) => {
            const { skill, latestVersion, owner, reports } = entry;
            const ownerParam = resolveOwnerParam(
              owner?.handle ?? null,
              owner?._id ?? skill.ownerUserId,
            );
            const reportEntries = reports ?? [];
            return (
              <div key={skill._id} className="management-item">
                <div className="management-item-main">
                  <Link to="/$owner/$slug" params={{ owner: ownerParam, slug: skill.slug }}>
                    {skill.displayName}
                  </Link>
                  <div className="section-subtitle m-0">
                    @{owner?.handle ?? owner?.name ?? "user"} · v{latestVersion?.version ?? "—"} ·
                    {t("management.reports.count", { count: skill.reportCount ?? 0 })}
                    {skill.lastReportedAt
                      ? ` · ${t("management.reports.last", {
                          time: formatTimestamp(skill.lastReportedAt, locale),
                        })}`
                      : ""}
                  </div>
                  {reportEntries.length > 0 ? (
                    <div className="management-sublist">
                      {reportEntries.map((report) => (
                        <div
                          key={`${report.reporterId}-${report.createdAt}`}
                          className="management-report-item"
                        >
                          <span className="management-report-meta">
                            {formatTimestamp(report.createdAt, locale)}
                            {report.reporterHandle ? ` · @${report.reporterHandle}` : ""}
                          </span>
                          <span>{report.reason}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="section-subtitle m-0">
                      {t("management.reports.no_reasons")}
                    </div>
                  )}
                </div>
                <div className="management-actions">
                  <Button asChild>
                    <Link
                      to="/management"
                      search={{
                        view: "skills",
                        skill: skill.slug,
                        plugin: undefined,
                      }}
                    >
                      {t("management.manage")}
                    </Link>
                  </Button>
                  <Button type="button" onClick={() => onToggleSkillHidden(skill)}>
                    {skill.softDeletedAt ? t("management.restore") : t("management.hide")}
                  </Button>
                  {admin ? (
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => onHardDeleteSkill(skill)}
                    >
                      {t("management.hard_delete")}
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
