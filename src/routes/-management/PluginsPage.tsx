import { Link } from "@tanstack/react-router";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { useLocale } from "../../lib/i18n/context";
import { familyLabel } from "../../lib/packageLabels";
import { formatTimestamp, type PluginByNameResult } from "./managementShared";

type PluginPackageId = NonNullable<NonNullable<PluginByNameResult>["package"]>["_id"];

export function PluginsPage({
  pluginSearch,
  selectedPlugin,
  selectedPluginName,
  onChangePluginSearch,
  onManagePlugin,
  onSetPackageBatch,
}: {
  pluginSearch: string;
  selectedPlugin: PluginByNameResult | undefined;
  selectedPluginName: string | undefined;
  onChangePluginSearch: (value: string) => void;
  onManagePlugin: () => void;
  onSetPackageBatch: (packageId: PluginPackageId, batch: "highlighted" | undefined) => void;
}) {
  const { locale, t } = useLocale();
  return (
    <div className="management-view">
      <h2 className="section-title text-[1.2rem] m-0">{t("management.plugins.title")}</h2>
      <p className="section-subtitle m-0 mt-1">{t("management.plugins.subtitle")}</p>
      <div className="management-controls">
        <div className="management-control management-search">
          <span className="mono">{t("management.plugins.package")}</span>
          <input
            type="search"
            placeholder="@scope/plugin-name or package-name"
            value={pluginSearch}
            onChange={(event) => onChangePluginSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onManagePlugin();
              }
            }}
          />
        </div>
        <Button type="button" onClick={onManagePlugin} disabled={!pluginSearch.trim()}>
          {t("management.manage")}
        </Button>
      </div>
      {selectedPluginName ? (
        <div className="section-subtitle mt-2">
          {t("management.plugins.managing", { name: selectedPluginName })} ·{" "}
          <Link
            to="/management"
            search={{
              view: "plugins",
              skill: undefined,
              plugin: undefined,
            }}
          >
            {t("management.clear_selection")}
          </Link>
        </div>
      ) : null}
      <div className="management-list">
        {!selectedPluginName ? (
          <div className="management-empty">{t("management.plugins.enter")}</div>
        ) : selectedPlugin === undefined ? (
          <div className="management-empty">{t("management.plugins.loading")}</div>
        ) : !selectedPlugin?.package ? (
          <div className="management-empty">
            {t("management.plugins.not_found", { name: selectedPluginName })}
          </div>
        ) : (
          (() => {
            const plugin = selectedPlugin.package;
            const owner = selectedPlugin.owner;
            const latestRelease = selectedPlugin.latestRelease;
            const isHighlighted = Boolean(selectedPlugin.highlighted);

            return (
              <div key={plugin._id} className="management-item management-item-detail">
                <div className="management-item-main">
                  <Link to="/plugins/$name" params={{ name: plugin.name }}>
                    {plugin.displayName}
                  </Link>
                  <div className="section-subtitle m-0">
                    {owner?.handle ? `@${owner.handle}` : t("management.plugins.unknown_owner")} ·{" "}
                    {familyLabel(plugin.family)} · v{latestRelease?.version ?? "—"} ·{" "}
                    {t("management.plugins.updated", {
                      time: formatTimestamp(plugin.updatedAt, locale),
                    })}
                    {plugin.softDeletedAt ? ` · ${t("management.plugins.hidden")}` : ""}
                    {isHighlighted ? ` · ${t("management.plugins.highlighted")}` : ""}
                  </div>
                  <div className="management-tags">
                    <Badge>{plugin.channel}</Badge>
                    {plugin.isOfficial ? (
                      <Badge variant="official">{t("management.plugins.official")}</Badge>
                    ) : null}
                    {plugin.executesCode ? (
                      <Badge>{t("management.plugins.executes_code")}</Badge>
                    ) : null}
                    {plugin.runtimeId ? <Badge>{plugin.runtimeId}</Badge> : null}
                  </div>
                  <div className="management-sublist">
                    <div className="management-report-item">
                      <span className="management-report-meta">
                        {t("management.plugins.package_name")}
                      </span>
                      <span className="mono">{plugin.name}</span>
                    </div>
                    <div className="management-report-item">
                      <span className="management-report-meta">
                        {t("management.plugins.summary")}
                      </span>
                      <span>{plugin.summary ?? t("management.plugins.no_summary")}</span>
                    </div>
                    <div className="management-report-item">
                      <span className="management-report-meta">
                        {t("management.plugins.featured_state")}
                      </span>
                      <span>
                        {isHighlighted
                          ? t("management.plugins.highlighted_at", {
                              time: formatTimestamp(selectedPlugin.highlighted?.at ?? 0, locale),
                            })
                          : t("management.plugins.not_highlighted")}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="management-actions management-action-grid">
                  <Button asChild className="management-action-btn">
                    <Link to="/plugins/$name" params={{ name: plugin.name }}>
                      {t("management.view")}
                    </Link>
                  </Button>
                  <Button
                    className="management-action-btn"
                    type="button"
                    onClick={() =>
                      onSetPackageBatch(plugin._id, isHighlighted ? undefined : "highlighted")
                    }
                  >
                    {isHighlighted ? t("management.unhighlight") : t("management.highlight")}
                  </Button>
                </div>
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
}
