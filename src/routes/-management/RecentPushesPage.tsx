import { Link } from "@tanstack/react-router";
import { Button } from "../../components/ui/button";
import { useLocale } from "../../lib/i18n/context";
import {
  formatShortTimestamp,
  resolveOwnerParam,
  type RecentVersionEntry,
} from "./managementShared";

export function RecentPushesPage({
  recentVersions,
}: {
  recentVersions: RecentVersionEntry[] | undefined;
}) {
  const { locale, t } = useLocale();
  return (
    <div className="management-view">
      <h2 className="section-title text-[1.2rem] m-0">{t("management.recent.title")}</h2>
      <p className="section-subtitle m-0 mt-1">
        {t("management.recent.subtitle")}
      </p>
      <div className="management-list">
        {!recentVersions ? (
          <div className="management-empty">{t("management.recent.loading")}</div>
        ) : recentVersions.length === 0 ? (
          <div className="management-empty">{t("management.recent.empty")}</div>
        ) : (
          recentVersions.map((entry) => (
            <div key={entry.version._id} className="management-item">
              <div className="management-item-main">
                <strong>{entry.skill?.displayName ?? t("management.recent.unknown_skill")}</strong>
                <div className="section-subtitle m-0">
                  v{entry.version.version} · @{entry.owner?.handle ?? entry.owner?.name ?? "user"} ·{" "}
                  {formatShortTimestamp(entry.version._creationTime, locale)}
                </div>
              </div>
              <div className="management-actions">
                {entry.skill ? (
                  <Button asChild>
                    <Link
                      to="/management"
                      search={{
                        view: "skills",
                        skill: entry.skill.slug,
                        plugin: undefined,
                      }}
                    >
                      {t("management.manage")}
                    </Link>
                  </Button>
                ) : null}
                {entry.skill ? (
                  <Button asChild>
                    <Link
                      to="/$owner/$slug"
                      params={{
                        owner: resolveOwnerParam(
                          entry.owner?.handle ?? null,
                          entry.owner?._id ?? entry.skill.ownerUserId,
                        ),
                        slug: entry.skill.slug,
                      }}
                    >
                      {t("management.view")}
                    </Link>
                  </Button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
