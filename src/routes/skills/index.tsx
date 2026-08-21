import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { BrowseSidebar } from "../../components/BrowseSidebar";
import { SKILL_CATEGORIES } from "../../lib/categories";
import { fastifyApi } from "../../lib/fastifyApi";
import { t } from "../../lib/i18n";
import { useLocale } from "../../lib/i18n/context";
import { formatCompactStat } from "../../lib/numberFormat";
import { parseDir, parseSort } from "./-params";
import { SkillsResults } from "./-SkillsResults";
import {
  normalizeSkillsView,
  useSkillsBrowseModel,
  type SkillsSearchState,
} from "./-useSkillsBrowseModel";

const SKILL_CATEGORY_SLUGS = new Set(SKILL_CATEGORIES.map((category) => category.slug));

function parseSkillCategorySlug(value: unknown) {
  return typeof value === "string" && SKILL_CATEGORY_SLUGS.has(value) ? value : undefined;
}

export const Route = createFileRoute("/skills/")({
  validateSearch: (search): SkillsSearchState => {
    return {
      q: typeof search.q === "string" && search.q.trim() ? search.q : undefined,
      sort: typeof search.sort === "string" ? parseSort(search.sort) : undefined,
      dir: search.dir === "asc" || search.dir === "desc" ? search.dir : undefined,
      highlighted:
        search.highlighted === "1" || search.highlighted === "true" || search.highlighted === true
          ? true
          : undefined,
      featured:
        search.featured === "1" || search.featured === "true" || search.featured === true
          ? true
          : undefined,
      category: parseSkillCategorySlug(search.category),
      view: normalizeSkillsView(search.view),
      focus: search.focus === "search" ? "search" : undefined,
    };
  },
  component: SkillsIndex,
});

export function SkillsIndex() {
  const { locale } = useLocale();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [totalSkills, setTotalSkills] = useState<number | null>(null);

  // Fetch total skills count
  useEffect(() => {
    fastifyApi
      .getSkills({ limit: 1 })
      .then((result) => {
        setTotalSkills(result.pagination.total);
      })
      .catch(() => {
        setTotalSkills(null);
      });
  }, []);

  const totalSkillsText = typeof totalSkills === "number" ? formatCompactStat(totalSkills) : null;
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const model = useSkillsBrowseModel({
    navigate,
    search,
    searchInputRef,
  });

  const BROWSE_SORT_OPTIONS = [
    { value: "recommended", label: t("skills.sort.recommended", locale) },
    { value: "downloads", label: t("skills.sort.most_downloaded", locale) },
    { value: "stars", label: t("skills.sort.most_starred", locale) },
    { value: "installs", label: t("skills.sort.most_installed", locale) },
    { value: "updated", label: t("skills.sort.recently_updated", locale) },
    { value: "newest", label: t("skills.sort.newest", locale) },
    { value: "name", label: t("skills.sort.name", locale) },
  ];

  const SEARCH_SORT_OPTIONS = [
    { value: "downloads", label: t("skills.sort.most_downloaded", locale) },
    { value: "stars", label: t("skills.sort.most_starred", locale) },
    { value: "installs", label: t("skills.sort.most_installed", locale) },
    { value: "updated", label: t("skills.sort.recently_updated", locale) },
    { value: "newest", label: t("skills.sort.newest", locale) },
    { value: "name", label: t("skills.sort.name", locale) },
  ];

  const sortOptionsWithRelevance = model.hasQuery
    ? [{ value: "relevance", label: t("skills.sort.relevance", locale) }, ...SEARCH_SORT_OPTIONS]
    : BROWSE_SORT_OPTIONS;

  const handleSortChange = useCallback(
    (value: string) => {
      if (value === "featured") {
        if (!model.featuredOnly) model.onToggleFeatured();
        return;
      }

      if (model.featuredOnly) {
        const nextSort = parseSort(value);
        void navigate({
          search: (prev: SkillsSearchState) => {
            const reusePreviousDir =
              prev.sort !== undefined &&
              prev.sort !== "recommended" &&
              prev.sort !== "default" &&
              prev.sort !== "relevance";
            return {
              ...prev,
              sort: nextSort,
              dir:
                nextSort === "recommended" || nextSort === "default"
                  ? undefined
                  : parseDir(reusePreviousDir ? prev.dir : undefined, nextSort),
              featured: undefined,
              highlighted: undefined,
            };
          },
          replace: true,
        });
        return;
      }

      model.onSortChange(value);
    },
    [model.featuredOnly, model.onSortChange, model.onToggleFeatured, navigate],
  );

  const handleClear = useCallback(() => {
    model.onClearFilters();
  }, [model.onClearFilters]);

  const handleCategoryChange = useCallback(
    (slug: string | undefined) => {
      const category = parseSkillCategorySlug(slug);
      void navigate({
        search: (prev: SkillsSearchState) => ({
          ...prev,
          category,
          featured: undefined,
          highlighted: undefined,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  return (
    <main className="browse-page">
      <div className="browse-page-header">
        <button
          className="browse-sidebar-toggle"
          type="button"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle filters"
        >
          {t("skills.filters", locale)}
        </button>
        <h1 className="browse-title">
          {t("skills.title", locale)}
          {totalSkillsText ? <span className="browse-count">{totalSkillsText}</span> : null}
        </h1>
      </div>
      <div className={`browse-layout${sidebarOpen ? " sidebar-open" : ""}`}>
        <BrowseSidebar
          categories={SKILL_CATEGORIES}
          activeCategory={model.activeCategory}
          onCategoryChange={handleCategoryChange}
          sortOptions={[
            { value: "featured", label: t("skills.featured", locale) },
            ...sortOptionsWithRelevance,
          ]}
          activeSort={model.featuredOnly ? "featured" : model.sort}
          onSortChange={handleSortChange}
        />
        <div className="browse-results">
          <div className="browse-results-toolbar">
            <span className="browse-results-count">
              {model.isLoadingSkills
                ? "\u2014"
                : t("common.results", locale).replace("{count}", String(model.sorted.length))}
              {model.hasQuery || model.activeCategory || model.featuredOnly ? (
                <button className="browse-clear-btn" type="button" onClick={handleClear}>
                  {t("common.clear", locale)}
                </button>
              ) : null}
            </span>
            <div className="browse-results-actions">
              <div className="browse-view-toggle">
                <button
                  className={`browse-view-btn${model.view === "list" ? " is-active" : ""}`}
                  type="button"
                  onClick={model.view === "grid" ? model.onToggleView : undefined}
                >
                  {t("home.card.skill", locale)}
                </button>
                <button
                  className={`browse-view-btn${model.view === "grid" ? " is-active" : ""}`}
                  type="button"
                  onClick={model.view === "list" ? model.onToggleView : undefined}
                >
                  {t("home.section.view_all", locale)}
                </button>
              </div>
            </div>
          </div>
          <SkillsResults
            isLoadingSkills={model.isLoadingSkills}
            sorted={model.sorted}
            view={model.view}
            listDoneLoading={!model.isLoadingSkills && !model.canLoadMore && !model.isLoadingMore}
            hasQuery={model.hasQuery}
            canLoadMore={model.canLoadMore}
            isLoadingMore={model.isLoadingMore}
            canAutoLoad={model.canAutoLoad}
            loadMoreRef={model.loadMoreRef}
            loadMore={model.loadMore}
          />
        </div>
      </div>
    </main>
  );
}
