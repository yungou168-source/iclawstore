import { createFileRoute, redirect } from "@tanstack/react-router";
import { isPluginCategorySlug } from "clawhub-schema";
import { PackageSearch } from "lucide-react";
import { useMemo, useState } from "react";
import { BrowseSidebar } from "../../components/BrowseSidebar";
import { PluginListItem } from "../../components/PluginListItem";
import { BrowseResultsSkeleton } from "../../components/skeletons/BrowseResultsSkeleton";
import { Button } from "../../components/ui/button";
import { PLUGIN_CATEGORIES } from "../../lib/categories";
import { t } from "../../lib/i18n";
import type { Locale } from "../../lib/i18n/config";
import { useLocale } from "../../lib/i18n/context";
import {
  fetchPluginCatalog,
  isRateLimitedPackageApiError,
  type PackageListItem,
} from "../../lib/packageApi";

type PluginSort = "relevance" | "updated" | "downloads" | "newest" | "name";

const PLUGINS_PAGE_SIZE = 100;

type PluginSearchState = {
  q?: string;
  category?: string;
  cursor?: string;
  family?: undefined;
  featured?: boolean;
  official?: boolean;
  executesCode?: boolean;
  sort?: PluginSort;
  view?: LegacyPluginView;
};

type PluginView = "list" | "grid";
type LegacyPluginView = PluginView | "cards";

function normalizePluginView(value: unknown): PluginView | undefined {
  if (value === "list") return "list";
  if (value === "grid" || value === "cards") return "grid";
  return undefined;
}

type PluginsLoaderData = {
  items: PackageListItem[];
  nextCursor: string | null;
  rateLimited: boolean;
  retryAfterSeconds: number | null;
  apiError?: boolean;
};

function formatRetryDelay(retryAfterSeconds: number | null, locale: Locale = "en") {
  if (!retryAfterSeconds || retryAfterSeconds <= 0) return t("common.in_a_moment", locale);
  if (retryAfterSeconds < 60) {
    return t("plugins.retry_in_seconds", locale, { seconds: retryAfterSeconds });
  }
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return t("plugins.retry_in_minutes", locale, { minutes });
}

function parsePluginSort(value: unknown): PluginSort | undefined {
  if (
    value === "relevance" ||
    value === "updated" ||
    value === "downloads" ||
    value === "newest" ||
    value === "name"
  ) {
    return value;
  }
  return undefined;
}

function sortPluginSearchItems(items: PackageListItem[], sort: PluginSort) {
  if (sort === "relevance") return items;
  const sorted = [...items];
  sorted.sort((a, b) => {
    const tieBreak = () =>
      b.updatedAt - a.updatedAt ||
      b.createdAt - a.createdAt ||
      a.family.localeCompare(b.family) ||
      a.name.localeCompare(b.name);

    if (sort === "name") {
      return (
        a.displayName.localeCompare(b.displayName) ||
        a.name.localeCompare(b.name) ||
        a.family.localeCompare(b.family)
      );
    }

    if (sort === "newest") {
      return (
        b.createdAt - a.createdAt ||
        b.updatedAt - a.updatedAt ||
        a.family.localeCompare(b.family) ||
        a.name.localeCompare(b.name)
      );
    }

    if (sort === "downloads") {
      return (b.stats?.downloads ?? 0) - (a.stats?.downloads ?? 0) || tieBreak();
    }

    return tieBreak();
  });
  return sorted;
}

function formatPluginHeadingCount(
  count: number,
  hasNextPage: boolean,
  hasPreviousPage: boolean,
  locale: Locale = "en",
) {
  if (hasPreviousPage) return t("plugins.showing", locale, { count });
  if (hasNextPage) return `${count}+`;
  return String(count);
}

function formatPluginResultsCount(
  count: number,
  hasNextPage: boolean,
  hasPreviousPage: boolean,
  locale: Locale = "en",
) {
  if (hasPreviousPage) return t("plugins.results_shown", locale, { count });
  if (hasNextPage) return t("plugins.results_plus", locale, { count });
  return t("plugins.results_total", locale, { count });
}

export const Route = createFileRoute("/plugins/")({
  pendingComponent: PluginsIndexPending,
  validateSearch: (search): PluginSearchState => ({
    q: typeof search.q === "string" && search.q.trim() ? search.q.trim() : undefined,
    category:
      typeof search.category === "string" && isPluginCategorySlug(search.category)
        ? search.category
        : undefined,
    cursor: typeof search.cursor === "string" && search.cursor ? search.cursor : undefined,
    featured:
      search.featured === true || search.featured === "true" || search.featured === "1"
        ? true
        : undefined,
    official:
      search.official === true ||
      search.official === "true" ||
      search.official === "1" ||
      search.verified === true ||
      search.verified === "true" ||
      search.verified === "1"
        ? true
        : undefined,
    executesCode:
      search.executesCode === true || search.executesCode === "true" || search.executesCode === "1"
        ? true
        : undefined,
    sort: parsePluginSort(search.sort),
    view: normalizePluginView(search.view),
  }),
  beforeLoad: ({ search }) => {
    const hasQuery = Boolean(search.q?.trim());
    const incompatibleSort =
      !hasQuery && search.sort && search.sort !== "updated" && search.sort !== "downloads";
    const browseOnlyFeatured = hasQuery && search.featured;
    const invalidCategory = Boolean(search.category && !isPluginCategorySlug(search.category));
    if (incompatibleSort || browseOnlyFeatured || invalidCategory) {
      throw redirect({
        to: "/plugins",
        search: {
          ...search,
          category: invalidCategory ? undefined : search.category,
          featured: browseOnlyFeatured ? undefined : search.featured,
          sort: incompatibleSort ? undefined : search.sort,
        },
        replace: true,
      });
    }
  },
  loaderDeps: ({ search }) => ({
    q: search.q,
    category: search.category,
    cursor: search.cursor,
    featured: search.featured,
    official: search.official,
    executesCode: search.executesCode,
    sort: search.sort,
  }),
  loader: async ({ deps }): Promise<PluginsLoaderData> => {
    try {
      const data = await fetchPluginCatalog({
        q: deps.q,
        category: deps.category,
        cursor: deps.q ? undefined : deps.cursor,
        featured: deps.featured,
        isOfficial: deps.official,
        executesCode: deps.executesCode,
        ...(!deps.q && deps.sort === "downloads" ? { sort: deps.sort } : {}),
        limit: PLUGINS_PAGE_SIZE,
      });

      return {
        items: data?.items ?? [],
        nextCursor: data?.nextCursor ?? null,
        rateLimited: false,
        retryAfterSeconds: null,
        apiError: false,
      };
    } catch (error) {
      if (isRateLimitedPackageApiError(error)) {
        return {
          items: [],
          nextCursor: null,
          rateLimited: true,
          retryAfterSeconds: error.retryAfterSeconds,
          apiError: false,
        };
      }

      return {
        items: [],
        nextCursor: null,
        rateLimited: false,
        retryAfterSeconds: null,
        apiError: true,
      };
    }
  },
  component: PluginsIndex,
});

function PluginsIndexPending() {
  const { locale } = useLocale();
  return (
    <main className="browse-page">
      <div className="browse-page-header">
        <button className="browse-sidebar-toggle" type="button" disabled>
          {t("plugins.filters", locale)}
        </button>
        <h1 className="browse-title">{t("plugins.title", locale)}</h1>
      </div>
      <div className="browse-layout">
        <BrowseSidebar
          categories={PLUGIN_CATEGORIES}
          activeCategory={undefined}
          onCategoryChange={() => {}}
          sortOptions={[
            { value: "featured", label: t("plugins.featured", locale) },
            { value: "downloads", label: t("plugins.sort.downloads", locale) },
            { value: "updated", label: t("plugins.sort.updated", locale) },
          ]}
          activeSort="updated"
          onSortChange={() => {}}
          filters={[
            { key: "official", label: t("plugins.official", locale), active: false },
            { key: "executesCode", label: t("plugins.executes_code", locale), active: false },
          ]}
          onFilterToggle={() => {}}
        />
        <div className="browse-results">
          <div className="browse-results-toolbar">
            <span className="browse-results-count">{t("common.loading", locale)}</span>
            <div className="browse-view-toggle">
              <button className="browse-view-btn is-active" type="button" disabled>
                {t("common.list", locale)}
              </button>
              <button className="browse-view-btn" type="button" disabled>
                {t("common.grid", locale)}
              </button>
            </div>
          </div>
          <BrowseResultsSkeleton />
        </div>
      </div>
    </main>
  );
}

function PluginsIndex() {
  const { locale } = useLocale();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const loaderData = Route.useLoaderData() as PluginsLoaderData | undefined;

  // Defensive handling for when loader data is unavailable (SSR errors, etc.)
  const items = loaderData?.items ?? [];
  const nextCursor = loaderData?.nextCursor ?? null;
  const rateLimited = loaderData?.rateLimited ?? false;
  const retryAfterSeconds = loaderData?.retryAfterSeconds ?? null;
  const apiError = loaderData?.apiError ?? !loaderData;
  const view = normalizePluginView(search.view) ?? "list";

  const [sidebarOpen, setSidebarOpen] = useState(false);

  const hasQuery = Boolean(search.q?.trim());

  const activeCategory = search.category;

  const activeSort = hasQuery
    ? (search.sort ?? "relevance")
    : search.featured
      ? "featured"
      : (search.sort ?? "updated");
  const visibleItems = useMemo(
    () => (hasQuery ? sortPluginSearchItems(items, activeSort as PluginSort) : items),
    [activeSort, hasQuery, items],
  );
  const hasPreviousPage = Boolean(!hasQuery && search.cursor);
  const hasNextPage = Boolean(!hasQuery && nextCursor);
  const headingCount = formatPluginHeadingCount(
    visibleItems.length,
    hasNextPage,
    hasPreviousPage,
    locale,
  );
  const resultsCount = formatPluginResultsCount(
    visibleItems.length,
    hasNextPage,
    hasPreviousPage,
    locale,
  );

  const sortOptions = useMemo(() => {
    if (hasQuery) {
      return [
        { value: "relevance", label: t("plugins.sort.relevance", locale) },
        { value: "downloads", label: t("plugins.sort.downloads", locale) },
        { value: "updated", label: t("plugins.sort.updated", locale) },
        { value: "newest", label: t("plugins.sort.newest", locale) },
        { value: "name", label: t("plugins.sort.name", locale) },
      ];
    }
    return [
      { value: "featured", label: t("plugins.featured", locale) },
      { value: "downloads", label: t("plugins.sort.downloads", locale) },
      { value: "updated", label: t("plugins.sort.updated", locale) },
    ];
  }, [hasQuery, locale]);

  const handleFilterToggle = (key: string) => {
    if (key === "official") {
      void navigate({
        search: (prev: PluginSearchState) => ({
          ...prev,
          cursor: undefined,
          official: prev.official ? undefined : true,
        }),
      });
    } else if (key === "executesCode") {
      void navigate({
        search: (prev: PluginSearchState) => ({
          ...prev,
          cursor: undefined,
          executesCode: prev.executesCode ? undefined : true,
        }),
      });
    }
  };

  const handleSortChange = (value: string) => {
    if (value === "featured") {
      void navigate({
        search: (prev: PluginSearchState) => ({
          ...prev,
          cursor: undefined,
          featured: true,
          family: undefined,
          q: undefined,
          sort: undefined,
        }),
      });
      return;
    }

    if (hasQuery) {
      void navigate({
        search: (prev: PluginSearchState) => ({
          ...prev,
          cursor: undefined,
          family: undefined,
          featured: undefined,
          sort: parsePluginSort(value) === "relevance" ? undefined : parsePluginSort(value),
        }),
        replace: true,
      });
      return;
    }

    void navigate({
      search: (prev: PluginSearchState) => ({
        ...prev,
        cursor: undefined,
        family: undefined,
        featured: undefined,
        sort: parsePluginSort(value) === "updated" ? undefined : parsePluginSort(value),
      }),
      replace: true,
    });
  };

  const handleCategoryChange = (slug: string | undefined) => {
    const category = slug && isPluginCategorySlug(slug) ? slug : undefined;
    void navigate({
      search: (prev: PluginSearchState) => ({
        ...prev,
        cursor: undefined,
        family: undefined,
        category,
        featured: undefined,
        sort: undefined,
      }),
      replace: true,
    });
  };

  const handleToggleView = () => {
    void navigate({
      search: (prev: PluginSearchState) => ({
        ...prev,
        view: normalizePluginView(prev.view) === "grid" ? undefined : "grid",
      }),
      replace: true,
    });
  };

  const handleClear = () => {
    void navigate({
      search: (prev: PluginSearchState) => ({
        ...prev,
        cursor: undefined,
        family: undefined,
        q: undefined,
        category: undefined,
        official: undefined,
        executesCode: undefined,
        featured: undefined,
        sort: undefined,
      }),
      replace: true,
    });
  };

  return (
    <main className="browse-page">
      <div className="browse-page-header">
        <button
          className="browse-sidebar-toggle"
          type="button"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label={t("browse.aria.toggle_filters", locale)}
        >
          {t("plugins.filters", locale)}
        </button>
        <h1 className="browse-title">
          {t("plugins.title", locale)} <span className="browse-count">{headingCount}</span>
        </h1>
      </div>
      <div className={`browse-layout${sidebarOpen ? " sidebar-open" : ""}`}>
        <BrowseSidebar
          categories={PLUGIN_CATEGORIES}
          activeCategory={activeCategory}
          onCategoryChange={handleCategoryChange}
          sortOptions={sortOptions}
          activeSort={activeSort}
          onSortChange={handleSortChange}
          filters={[
            {
              key: "official",
              label: t("plugins.official", locale),
              active: search.official ?? false,
            },
            {
              key: "executesCode",
              label: t("plugins.executes_code", locale),
              active: search.executesCode ?? false,
            },
          ]}
          onFilterToggle={handleFilterToggle}
        />
        <div className="browse-results">
          <div className="browse-results-toolbar">
            <span className="browse-results-count">
              {resultsCount}
              {hasQuery ||
              search.category ||
              search.official ||
              search.executesCode ||
              search.featured ? (
                <button className="browse-clear-btn" type="button" onClick={handleClear}>
                  {t("plugins.clear_filters", locale)}
                </button>
              ) : null}
            </span>
            <div className="browse-view-toggle">
              <button
                className={`browse-view-btn${view === "list" ? " is-active" : ""}`}
                type="button"
                onClick={view === "grid" ? handleToggleView : undefined}
              >
                {t("common.list", locale)}
              </button>
              <button
                className={`browse-view-btn${view === "grid" ? " is-active" : ""}`}
                type="button"
                onClick={view === "list" ? handleToggleView : undefined}
              >
                {t("common.grid", locale)}
              </button>
            </div>
          </div>

          {apiError ? (
            <div className="empty-state">
              <PackageSearch size={22} className="empty-state-icon" aria-hidden="true" />
              <p className="empty-state-title">{t("plugins.load_error_title", locale)}</p>
              <p className="empty-state-body">{t("plugins.load_error_description", locale)}</p>
            </div>
          ) : rateLimited ? (
            <div className="empty-state">
              <PackageSearch size={22} className="empty-state-icon" aria-hidden="true" />
              <p className="empty-state-title">{t("plugins.rate_limited_title", locale)}</p>
              <p className="empty-state-body">
                {t("plugins.retry_after", locale, {
                  time: formatRetryDelay(retryAfterSeconds, locale),
                })}
              </p>
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">{t("plugins.no_results", locale)}</p>
              <p className="empty-state-body">{t("plugins.no_results_description", locale)}</p>
            </div>
          ) : (
            <div className={view === "grid" ? "grid" : "results-list"}>
              {visibleItems.map((item) => (
                <PluginListItem
                  key={item.name}
                  item={item}
                  locale={locale}
                  variant={view === "grid" ? "card" : "list"}
                />
              ))}
            </div>
          )}

          {!hasQuery && (search.cursor || nextCursor) ? (
            <div className="mt-5 flex justify-center gap-3">
              {search.cursor ? (
                <Button
                  type="button"
                  onClick={() => {
                    void navigate({
                      search: (prev: PluginSearchState) => ({ ...prev, cursor: undefined }),
                    });
                  }}
                >
                  {t("plugins.first_page", locale)}
                </Button>
              ) : null}
              {nextCursor ? (
                <Button
                  variant="primary"
                  type="button"
                  onClick={() => {
                    void navigate({
                      search: (prev: PluginSearchState) => ({ ...prev, cursor: nextCursor }),
                    });
                  }}
                >
                  {t("plugins.next_page", locale)}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
