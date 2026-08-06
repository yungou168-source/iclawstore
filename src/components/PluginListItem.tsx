import { Link } from "@tanstack/react-router";
import { ArrowDownToLine } from "lucide-react";
import { formatCompactStat } from "../lib/numberFormat";
import { t, type Locale } from "../lib/i18n";
import type { PackageListItem } from "../lib/packageApi";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { OfficialBadge } from "./OfficialBadge";

type PluginListItemProps = {
  item: PackageListItem;
  variant?: "list" | "card";
  locale?: Locale;
};

export function PluginListItem({ item, variant = "list", locale = "en" }: PluginListItemProps) {
  const downloads = formatCompactStat(item.stats?.downloads ?? 0);
  const officialLabel = t("plugins.official", locale);
  const fallbackSummary = t("plugins.item_fallback_summary", locale);
  const itemType = t("plugins.item_type", locale);
  const communityLabel = t("plugins.item_community", locale);
  const ariaLabel = t("plugins.item_aria_label", locale, { name: item.displayName });

  if (variant === "card") {
    return (
      <Link
        to="/plugins/$name"
        params={{ name: item.name }}
        className="card skill-card plugin-card"
        aria-label={ariaLabel}
      >
        {item.isOfficial ? (
          <div className="skill-card-tags">
            <OfficialBadge label={officialLabel} />
          </div>
        ) : null}
        <div className="skill-card-header">
          <MarketplaceIcon kind="plugin" label={item.displayName} size="md" />
          <h3 className="skill-card-title">{item.displayName}</h3>
        </div>
        <p className="skill-card-summary">
          {item.summary ?? fallbackSummary}
        </p>
        <div className="skill-card-footer">
          <div className="skill-list-item-meta plugin-card-meta">
            <span className="skill-list-item-meta-item">{itemType}</span>
            {item.latestVersion ? (
              <span className="skill-list-item-meta-item">v{item.latestVersion}</span>
            ) : null}
            <span className="skill-list-item-meta-item">
              <ArrowDownToLine size={14} aria-hidden="true" /> {downloads}
            </span>
            <span className="skill-list-item-meta-item">
              {item.ownerHandle ? `@${item.ownerHandle}` : communityLabel}
            </span>
          </div>
        </div>
      </Link>
    );
  }

  return (
    <Link
      to="/plugins/$name"
      params={{ name: item.name }}
      className="skill-list-item"
      aria-label={ariaLabel}
    >
      <MarketplaceIcon kind="plugin" label={item.displayName} />
      <div className="skill-list-item-body">
        <div className="skill-list-item-main">
          {item.ownerHandle ? (
            <>
              <span className="skill-list-item-owner">@{item.ownerHandle}</span>
              <span className="skill-list-item-sep">/</span>
            </>
          ) : null}
          <span className="skill-list-item-name">{item.displayName}</span>
          {item.isOfficial ? <OfficialBadge label={officialLabel} /> : null}
        </div>
        <p className="skill-list-item-summary">
          {item.summary ?? fallbackSummary}
        </p>
        <div className="skill-list-item-meta">
          <span className="skill-list-item-meta-item">{itemType}</span>
          {item.latestVersion ? (
            <span className="skill-list-item-meta-item">v{item.latestVersion}</span>
          ) : null}
          <span className="skill-list-item-meta-item">
            <ArrowDownToLine size={14} aria-hidden="true" /> {downloads}
          </span>
          <span className="skill-list-item-meta-item">
            {item.ownerHandle ? `@${item.ownerHandle}` : communityLabel}
          </span>
        </div>
      </div>
    </Link>
  );
}
