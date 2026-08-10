import {
  Activity,
  Database,
  GitBranch,
  MessageCircle,
  MessageSquare,
  Package,
  Plug,
  RefreshCw,
  Rocket,
  Shield,
  Wrench,
  Zap,
} from "lucide-react";
import type { BrowseCategory } from "../lib/categories";
import { t, type TranslationKey } from "../lib/i18n";
import { useLocale } from "../lib/i18n/context";

type FilterItem = {
  key: string;
  label: string;
  active: boolean;
};

type SortOption = {
  value: string;
  label: string;
};

type BrowseSidebarProps = {
  categories?: BrowseCategory[];
  activeCategory?: string;
  onCategoryChange?: (slug: string | undefined) => void;
  sortOptions: SortOption[];
  activeSort: string;
  onSortChange: (value: string) => void;
  filters?: FilterItem[];
  onFilterToggle?: (key: string) => void;
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  activity: <Activity size={15} />,
  database: <Database size={15} />,
  "git-branch": <GitBranch size={15} />,
  "message-circle": <MessageCircle size={15} />,
  "message-square": <MessageSquare size={15} />,
  package: <Package size={15} />,
  plug: <Plug size={15} />,
  "refresh-cw": <RefreshCw size={15} />,
  rocket: <Rocket size={15} />,
  shield: <Shield size={15} />,
  wrench: <Wrench size={15} />,
  zap: <Zap size={15} />,
};

function getCategoryIcon(icon: string) {
  return CATEGORY_ICONS[icon] ?? CATEGORY_ICONS.package;
}

// Map category slug to translation key
const CATEGORY_SLUG_TO_KEY: Record<string, TranslationKey> = {
  "mcp-tools": "skills.category.mcp_tools",
  prompts: "skills.category.prompts",
  workflows: "skills.category.workflows",
  "dev-tools": "skills.category.dev_tools",
  data: "skills.category.data",
  security: "skills.category.security",
  automation: "skills.category.automation",
  other: "skills.category.other",
};

function translateCategoryLabel(slug: string, label: string, locale: string): string {
  const key = CATEGORY_SLUG_TO_KEY[slug];
  if (key) {
    return t(key, locale as "zh-CN" | "en");
  }
  return label;
}

export function BrowseSidebar({
  categories,
  activeCategory,
  onCategoryChange,
  sortOptions,
  activeSort,
  onSortChange,
  filters = [],
  onFilterToggle,
}: BrowseSidebarProps) {
  const { locale } = useLocale();

  const filterSection =
    filters.length && onFilterToggle ? (
      <fieldset className="sidebar-section" aria-label={t("browse.aria.toggle_filters", locale)}>
        <legend className="sidebar-title">{t("common.filter", locale)}</legend>
        {filters.map((f) => (
          <label key={f.key} className="sidebar-checkbox">
            <input
              type="checkbox"
              checked={f.active}
              onChange={() => onFilterToggle(f.key)}
              aria-label={f.label}
            />
            <span>{f.label}</span>
          </label>
        ))}
      </fieldset>
    ) : null;

  return (
    <aside className="browse-sidebar" aria-label={t("browse.aria.filters", locale)}>
      <fieldset
        className="sidebar-section"
        role="radiogroup"
        aria-label={t("browse.aria.sort_order", locale)}
      >
        <legend className="sidebar-title">{t("skills.sort_by", locale)}</legend>
        {sortOptions.map((opt) => (
          <button
            key={opt.value}
            className={`sidebar-option${activeSort === opt.value ? " is-active" : ""}`}
            type="button"
            role="radio"
            aria-checked={activeSort === opt.value}
            onClick={() => onSortChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </fieldset>

      {categories && onCategoryChange ? (
        <fieldset
          className="sidebar-section"
          role="radiogroup"
          aria-label={t("browse.aria.category_filter", locale)}
        >
          <legend className="sidebar-title">{t("skills.category.all", locale)}</legend>
          <button
            className={`sidebar-option${!activeCategory ? " is-active" : ""}`}
            type="button"
            role="radio"
            aria-checked={!activeCategory}
            onClick={() => onCategoryChange(undefined)}
          >
            {t("skills.all_categories", locale)}
          </button>
          {categories.map((cat) => (
            <button
              key={cat.slug}
              className={`sidebar-option${activeCategory === cat.slug ? " is-active" : ""}`}
              type="button"
              role="radio"
              aria-checked={activeCategory === cat.slug}
              onClick={() => onCategoryChange(cat.slug)}
            >
              <span className="sidebar-option-icon" aria-hidden="true">
                {getCategoryIcon(cat.icon)}
              </span>
              {translateCategoryLabel(cat.slug, cat.label, locale)}
            </button>
          ))}
        </fieldset>
      ) : null}

      {filterSection}
    </aside>
  );
}
