import { useAuthActions } from "@convex-dev/auth/react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  Building2,
  ChevronDown,
  LayoutDashboard,
  Menu,
  Monitor,
  Moon,
  Search,
  Settings,
  Star,
  Sun,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gravatarUrl } from "../lib/gravatar";
import { useLocale } from "../lib/i18n/context";
import { NAV_ICONS } from "../lib/marketplaceIcons";
import {
  AI_WORK_REPOSITORY_URL,
  filterNavItems,
  PRIMARY_NAV_ITEMS,
  SECONDARY_NAV_ITEMS,
} from "../lib/nav-items";
import { isModerator } from "../lib/roles";
import { getClawHubSiteUrl, getSiteMode, getSiteName } from "../lib/site";
import { applyTheme, useThemeMode } from "../lib/theme";
import { useAuthStatus } from "../lib/useAuthStatus";
import {
  useUnifiedSearch,
  type UnifiedPluginResult,
  type UnifiedSkillResult,
} from "../lib/useUnifiedSearch";
import { LanguageSwitcher } from "./LanguageSwitcher";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { UnifiedSignInDialog } from "./UnifiedSignInDialog";

const THEME_MODE_SEQUENCE: Array<"system" | "light" | "dark"> = ["system", "light", "dark"];

const WORKSPACE_NAV_PATHS = new Set([
  "/",
  "/recruit-ai",
  "/desktop-client",
  "/skills",
  "/plugins",
  "/publishers",
  "/settings",
  "/stars",
  "/dashboard",
  "/wallet",
  "/ai-work-admin/organizations",
]);

type TypeaheadItem =
  | {
      kind: "skill";
      key: string;
      result: UnifiedSkillResult;
    }
  | {
      kind: "plugin";
      key: string;
      result: UnifiedPluginResult;
    }
  | {
      kind: "footer";
      key: string;
      section: "skills" | "plugins";
      label: string;
    };

const NAV_LABEL_KEYS = {
  Skills: "nav.skills",
  Plugins: "nav.plugins",
  Souls: "nav.souls",
  Publishers: "nav.publishers",
  Home: "nav.home",
} as const;

export default function Header() {
  const { locale, t } = useLocale();
  const { isAuthenticated, isLoading, me } = useAuthStatus();
  const { signOut } = useAuthActions();
  const { theme, mode, setMode } = useThemeMode();
  const siteMode = getSiteMode();
  const siteName = useMemo(() => getSiteName(siteMode), [siteMode]);
  const isSoulMode = siteMode === "souls";
  const clawHubUrl = getClawHubSiteUrl();
  const navigate = useNavigate();
  const location = useLocation();

  const avatar = me?.image ?? (me?.email ? gravatarUrl(me.email) : undefined);
  const rawHandle = me?.handle ?? me?.displayName ?? "user";
  const handle = rawHandle.length > 25 ? `${rawHandle.slice(0, 25)}…` : rawHandle;
  const initial = (me?.displayName ?? me?.name ?? rawHandle).charAt(0).toUpperCase();
  const isStaff = isModerator(me);
  const hasResolvedUser = Boolean(me);
  const isAuthResolving = isLoading || (isAuthenticated && me === undefined);
  const navCtx = useMemo(
    () => ({ isSoulMode, isAuthenticated: hasResolvedUser, isStaff }),
    [hasResolvedUser, isSoulMode, isStaff],
  );
  const signInRedirectTo = getCurrentRelativeUrl();

  const getNavLabel = useCallback(
    (key: string): string =>
      key in NAV_LABEL_KEYS ? t(NAV_LABEL_KEYS[key as keyof typeof NAV_LABEL_KEYS]) : key,
    [t],
  );

  const translatedPrimaryItems = useMemo(
    () =>
      filterNavItems(PRIMARY_NAV_ITEMS, navCtx).map((item) => ({
        ...item,
        label: getNavLabel(item.label),
      })),
    [navCtx, getNavLabel],
  );

  const translatedSecondaryItems = useMemo(
    () =>
      filterNavItems(SECONDARY_NAV_ITEMS, navCtx).map((item) => ({
        ...item,
        label: getNavLabel(item.label),
      })),
    [navCtx, getNavLabel],
  );

  const primaryItems = translatedPrimaryItems;
  const secondaryItems = translatedSecondaryItems;

  const [navSearchQuery, setNavSearchQuery] = useState("");
  const [typeaheadOpen, setTypeaheadOpen] = useState(false);
  const [typeaheadActiveIndex, setTypeaheadActiveIndex] = useState(0);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  const ThemeModeIcon = getThemeModeIcon(mode);
  const trimmedNavSearchQuery = navSearchQuery.trim();
  const showTypeahead = !isSoulMode && typeaheadOpen && trimmedNavSearchQuery.length > 0;
  const {
    skillResults,
    pluginResults,
    isSearching: typeaheadSearching,
  } = useUnifiedSearch(navSearchQuery, "all", {
    debounceMs: 180,
    enabled: showTypeahead,
    limits: { skills: 4, plugins: 4 },
  });
  const typeaheadItems = useMemo<TypeaheadItem[]>(() => {
    if (!showTypeahead) return [];
    const items: TypeaheadItem[] = [];
    for (const result of skillResults) {
      items.push({ kind: "skill", key: `skill-${result.skill._id}`, result });
    }
    if (skillResults.length > 0) {
      items.push({
        kind: "footer",
        key: "footer-skills",
        section: "skills",
        label: t("header.typeahead_skills", { query: trimmedNavSearchQuery }),
      });
    }
    for (const result of pluginResults) {
      items.push({ kind: "plugin", key: `plugin-${result.plugin.name}`, result });
    }
    if (pluginResults.length > 0) {
      items.push({
        kind: "footer",
        key: "footer-plugins",
        section: "plugins",
        label: t("header.typeahead_plugins", { query: trimmedNavSearchQuery }),
      });
    }
    return items;
  }, [pluginResults, showTypeahead, skillResults, t, trimmedNavSearchQuery]);
  const activeTypeaheadItem = showTypeahead ? typeaheadItems[typeaheadActiveIndex] : undefined;
  const activeTypeaheadId = activeTypeaheadItem
    ? getTypeaheadOptionId(activeTypeaheadItem)
    : undefined;

  useEffect(() => {
    setTypeaheadActiveIndex(0);
  }, [trimmedNavSearchQuery]);

  useEffect(() => {
    setTypeaheadActiveIndex((index) => Math.min(index, Math.max(typeaheadItems.length - 1, 0)));
  }, [typeaheadItems.length]);

  useEffect(() => {
    if (!typeaheadOpen) return () => {};
    const handlePointerDown = (event: PointerEvent) => {
      if (searchWrapRef.current?.contains(event.target as Node)) return;
      setTypeaheadOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [typeaheadOpen]);

  const setThemeMode = (next: "system" | "light" | "dark") => {
    applyTheme(next, theme);
    setMode(next);
  };

  const cycleThemeMode = () => {
    const currentIndex = Math.max(0, THEME_MODE_SEQUENCE.indexOf(mode));
    setThemeMode(THEME_MODE_SEQUENCE[(currentIndex + 1) % THEME_MODE_SEQUENCE.length] ?? "system");
  };

  const handleNavSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = navSearchQuery.trim();
    if (!q) return;
    void navigate({
      to: isSoulMode ? "/souls" : "/search",
      search: isSoulMode
        ? {
            q,
            sort: undefined,
            dir: undefined,
            view: undefined,
            focus: undefined,
          }
        : { q, type: undefined },
    });
    setNavSearchQuery("");
    setTypeaheadOpen(false);
    setMobileSearchOpen(false);
  };

  const navigateToTypeaheadItem = (item: TypeaheadItem) => {
    if (item.kind === "skill") {
      const resultOwnerHandle = item.result.ownerHandle?.trim();
      if (!resultOwnerHandle) {
        void navigate({
          to: "/search",
          search: { q: trimmedNavSearchQuery, type: "skills" },
        });
        setNavSearchQuery("");
        setTypeaheadOpen(false);
        setMobileSearchOpen(false);
        return;
      }
      void navigate({
        to: `/${encodeURIComponent(resultOwnerHandle)}/${encodeURIComponent(item.result.skill.slug)}`,
      });
    } else if (item.kind === "plugin") {
      void navigate({
        to: "/plugins/$name",
        params: { name: item.result.plugin.name },
      });
    } else {
      void navigate({
        to: "/search",
        search: { q: trimmedNavSearchQuery, type: item.section },
      });
    }
    setNavSearchQuery("");
    setTypeaheadOpen(false);
    setMobileSearchOpen(false);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (isSoulMode) return;
    if (event.key === "Escape") {
      setTypeaheadOpen(false);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;
    if (!showTypeahead || typeaheadItems.length === 0) {
      if (event.key === "ArrowDown" && trimmedNavSearchQuery) {
        setTypeaheadOpen(true);
        event.preventDefault();
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setTypeaheadActiveIndex((index) => (index + 1) % typeaheadItems.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setTypeaheadActiveIndex(
        (index) => (index - 1 + typeaheadItems.length) % typeaheadItems.length,
      );
    } else if (event.key === "Enter") {
      const activeItem = typeaheadItems[typeaheadActiveIndex];
      if (!activeItem) return;
      event.preventDefault();
      navigateToTypeaheadItem(activeItem);
    }
  };

  const normalizedPathname = location.pathname.replace(/\/+$/, "") || "/";
  const isWorkspaceSurface = !isSoulMode && WORKSPACE_NAV_PATHS.has(normalizedPathname);
  if (isWorkspaceSurface) {
    return (
      <header className="workspace-navbar">
        <Link to="/" className="workspace-navbar-brand">
          <img src="/ai-work-icon.svg?v=20260804-logo-fix" alt="" aria-hidden="true" />
          <span>{siteName}</span>
        </Link>
        <nav className="workspace-navbar-tabs" aria-label={t("header.primary_navigation")}>
          <Link to="/" activeOptions={{ exact: true }}>
            {t("nav.home")}
          </Link>
          <Link to="/recruit-ai">{t("header.hire_ai_employees")}</Link>
          <Link to="/desktop-client">{t("header.desktop_client")}</Link>
          {isAuthenticated && me ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="workspace-developer-trigger">
                  {t("header.developers")}
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem asChild>
                  <Link
                    to="/skills"
                    search={{
                      q: undefined,
                      sort: undefined,
                      dir: undefined,
                      highlighted: undefined,
                      view: undefined,
                      focus: undefined,
                    }}
                  >
                    {t("nav.skills")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/plugins">{t("nav.plugins")}</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </nav>
        <div className="workspace-navbar-actions">
          <LanguageSwitcher />
          {isAuthenticated && me ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="workspace-account-link">
                  {t("header.workspace")}
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to="/dashboard">{t("header.dashboard")}</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/wallet" search={{ recharge: undefined }}>
                    {t("header.wallet")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/settings">{t("header.settings")}</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/ai-work-admin/organizations">
                    {t("header.ai_direct_organizations")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void signOut()}>
                  {t("header.sign_out")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <UnifiedSignInDialog
              locale={locale}
              disabled={isLoading || isAuthResolving}
              redirectTo={signInRedirectTo}
            />
          )}
          <a
            className="workspace-github-link"
            href={AI_WORK_REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
          >
            Github
          </a>
        </div>
      </header>
    );
  }

  return (
    <header className="navbar">
      <div className="navbar-inner">
        {/* Row 1: Brand + Search + Actions */}
        <div className="navbar-top">
          <div className="nav-mobile">
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <button
                className="nav-mobile-trigger"
                type="button"
                aria-label={t("header.open_menu")}
                onClick={() => setMobileMenuOpen(true)}
              >
                <Menu className="h-4 w-4" aria-hidden="true" />
              </button>
              <SheetContent side="left" className="mobile-nav-sheet">
                <SheetHeader className="pr-10">
                  <SheetTitle>
                    <span className="mobile-nav-brand">
                      <span className="mobile-nav-brand-mark" aria-hidden="true">
                        <img
                          src="/ai-work-icon.svg?v=20260804-logo-fix"
                          alt=""
                          aria-hidden="true"
                          className="mobile-nav-brand-mark-image"
                        />
                      </span>
                      <span className="mobile-nav-brand-name">{siteName}</span>
                    </span>
                  </SheetTitle>
                  <SheetDescription>{t("header.browse_sections")}</SheetDescription>
                </SheetHeader>
                <div className="mobile-nav-section">
                  <SheetClose asChild>
                    <Link to="/" className="mobile-nav-link">
                      {t("nav.home")}
                    </Link>
                  </SheetClose>
                  {isSoulMode ? (
                    <SheetClose asChild>
                      <a href={clawHubUrl} className="mobile-nav-link">
                        {t("header.clawhub")}
                      </a>
                    </SheetClose>
                  ) : null}
                  {primaryItems
                    .filter((item) => item.to !== "/")
                    .map((item) => (
                      <SheetClose key={item.to + item.label} asChild>
                        <Link
                          to={item.to}
                          search={(item.search ?? {}) as never}
                          className="mobile-nav-link"
                        >
                          {item.label}
                        </Link>
                      </SheetClose>
                    ))}
                  {secondaryItems.map((item) => (
                    <SheetClose key={(item.href ?? item.to ?? "") + item.label} asChild>
                      {item.href ? (
                        <a href={item.href} className="mobile-nav-link">
                          {item.label}
                        </a>
                      ) : (
                        <Link
                          to={item.to}
                          search={(item.search ?? {}) as never}
                          className="mobile-nav-link"
                        >
                          {item.label}
                        </Link>
                      )}
                    </SheetClose>
                  ))}
                </div>
                <div className="mobile-nav-section">
                  <div className="mobile-nav-section-title">{t("header.theme_controls")}</div>
                  <button
                    className="mobile-nav-link"
                    type="button"
                    onClick={() => {
                      cycleThemeMode();
                      setMobileMenuOpen(false);
                    }}
                  >
                    <ThemeModeIcon className="h-4 w-4" aria-hidden="true" />
                    {mode === "system"
                      ? t("header.theme_system")
                      : mode === "light"
                        ? t("header.theme_light")
                        : t("header.theme_dark")}
                  </button>
                </div>
              </SheetContent>
            </Sheet>
          </div>

          <Link
            to="/"
            search={{ q: undefined, highlighted: undefined, search: undefined }}
            className="brand"
          >
            <span className="brand-mark">
              <img
                src="/ai-work-icon.svg?v=20260804-logo-fix"
                alt=""
                aria-hidden="true"
                className="brand-mark-image"
              />
            </span>
            <span className="brand-name brand-name-responsive">{siteName}</span>
          </Link>

          <div className="navbar-search-wrap" ref={searchWrapRef}>
            <form
              className="navbar-search"
              onSubmit={handleNavSearch}
              role="search"
              aria-label={t("header.site_search")}
            >
              <Search size={16} className="navbar-search-icon" aria-hidden="true" />
              <input
                className="navbar-search-input"
                type="search"
                role="combobox"
                placeholder={
                  isSoulMode ? t("header.search_souls_placeholder") : t("header.search_placeholder")
                }
                value={navSearchQuery}
                onChange={(e) => {
                  setNavSearchQuery(e.target.value);
                  setTypeaheadOpen(true);
                }}
                onFocus={() => setTypeaheadOpen(true)}
                onKeyDown={handleSearchKeyDown}
                aria-label={t("header.search")}
                aria-autocomplete="list"
                aria-expanded={showTypeahead}
                aria-controls="navbar-search-typeahead"
                aria-activedescendant={activeTypeaheadId}
                autoComplete="off"
              />
            </form>
            {showTypeahead ? (
              <SearchTypeahead
                activeIndex={typeaheadActiveIndex}
                items={typeaheadItems}
                loading={typeaheadSearching}
                onHoverItem={setTypeaheadActiveIndex}
                onSelectItem={navigateToTypeaheadItem}
                query={trimmedNavSearchQuery}
              />
            ) : null}
          </div>

          <div className="nav-actions">
            <button
              className="navbar-search-mobile-trigger"
              type="button"
              aria-label={t("header.search")}
              onClick={() => setMobileSearchOpen(!mobileSearchOpen)}
            >
              <Search size={18} aria-hidden="true" />
            </button>
            <div className="theme-toggle">
              <div className="theme-cycle-group" aria-label={t("header.theme_controls")}>
                <button
                  type="button"
                  className="theme-cycle-button theme-cycle-button-mode"
                  onClick={cycleThemeMode}
                  aria-label={t("header.theme_mode_current", { mode })}
                  title={t("header.theme_mode_current", { mode })}
                >
                  <ThemeModeIcon className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <ToggleGroup
                className="theme-mode-toggle"
                type="single"
                value={mode}
                onValueChange={(value) => {
                  if (!value) return;
                  setThemeMode(value as "system" | "light" | "dark");
                }}
                aria-label={t("header.theme_mode")}
              >
                <ToggleGroupItem value="system" aria-label={t("header.theme_system")}>
                  <Monitor className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">{t("header.theme_system")}</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="light" aria-label={t("header.theme_light")}>
                  <Sun className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">{t("header.theme_light")}</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="dark" aria-label={t("header.theme_dark")}>
                  <Moon className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">{t("header.theme_dark")}</span>
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            <LanguageSwitcher />
            {isAuthenticated && me ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="user-trigger" type="button">
                    {avatar ? (
                      <img
                        src={avatar}
                        alt={me.displayName ?? me.name ?? t("header.user_avatar")}
                      />
                    ) : (
                      <span className="user-menu-fallback">{initial}</span>
                    )}
                    <span className="mono truncate">@{handle}</span>
                    <ChevronDown className="user-menu-chevron" size={16} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="user-dropdown-content">
                  <DropdownMenuItem asChild>
                    <Link to="/dashboard" className="flex items-center gap-2">
                      <LayoutDashboard size={14} aria-hidden="true" />
                      {t("header.dashboard")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/stars" className="flex items-center gap-2">
                      <Star size={14} aria-hidden="true" />
                      {t("header.stars")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link
                      to="/wallet"
                      search={{ recharge: undefined }}
                      className="flex items-center gap-2"
                    >
                      <WalletCards size={14} aria-hidden="true" />
                      {t("header.wallet")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/settings" className="flex items-center gap-2">
                      <Settings size={14} aria-hidden="true" />
                      {t("header.settings")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/ai-work-admin/organizations" className="flex items-center gap-2">
                      <Building2 size={14} aria-hidden="true" />
                      {t("header.ai_direct_organizations")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void signOut()}>
                    {t("header.sign_out")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : isAuthResolving ? (
              <div className="github-sign-in-button auth-loading-placeholder" aria-hidden="true" />
            ) : (
              <UnifiedSignInDialog
                locale={locale}
                disabled={isLoading}
                redirectTo={signInRedirectTo}
              />
            )}
          </div>
        </div>

        {/* Mobile search bar (expandable) */}
        {mobileSearchOpen ? (
          <form className="navbar-search-mobile" onSubmit={handleNavSearch}>
            <Search size={16} className="navbar-search-icon" aria-hidden="true" />
            <input
              className="navbar-search-input"
              type="text"
              placeholder={
                isSoulMode ? t("header.search_souls_placeholder") : t("header.search_placeholder")
              }
              value={navSearchQuery}
              onChange={(e) => setNavSearchQuery(e.target.value)}
              autoFocus
            />
          </form>
        ) : null}

        <nav className="navbar-tabs" aria-label={t("header.content_types")}>
          <div className="navbar-tabs-primary">
            {isSoulMode ? (
              <a href={clawHubUrl} className="navbar-tab">
                {t("header.clawhub")}
              </a>
            ) : null}
            {primaryItems.map((item) => {
              const Icon = item.icon ? NAV_ICONS[item.icon] : null;
              const isActiveByPrefix = item.activePathPrefixes?.some((prefix) =>
                location.pathname.startsWith(prefix),
              );
              return (
                <Link
                  key={item.to + item.label}
                  to={item.to}
                  className="navbar-tab"
                  search={(item.search ?? {}) as never}
                  data-status={isActiveByPrefix ? "active" : undefined}
                >
                  {Icon ? <Icon size={14} className="opacity-50" aria-hidden="true" /> : null}
                  {item.label}
                </Link>
              );
            })}
          </div>
          <div className="navbar-tabs-secondary">
            {secondaryItems.map((item) => {
              const isActiveByPrefix = item.activePathPrefixes?.some((prefix) =>
                location.pathname.startsWith(prefix),
              );
              return item.href ? (
                <a
                  key={item.href + item.label}
                  href={item.href}
                  className="navbar-tab navbar-tab-secondary"
                >
                  {item.label}
                </a>
              ) : (
                <Link
                  key={(item.to ?? "") + item.label}
                  to={item.to}
                  search={(item.search ?? {}) as never}
                  className="navbar-tab navbar-tab-secondary"
                  data-status={isActiveByPrefix ? "active" : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </header>
  );
}

function SearchTypeahead({
  activeIndex,
  items,
  loading,
  onHoverItem,
  onSelectItem,
  query,
}: {
  activeIndex: number;
  items: TypeaheadItem[];
  loading: boolean;
  onHoverItem: (index: number) => void;
  onSelectItem: (item: TypeaheadItem) => void;
  query: string;
}) {
  const { t } = useLocale();
  const skillItems = items.filter((item) => item.kind === "skill");
  const pluginItems = items.filter((item) => item.kind === "plugin");
  const footerItems = items.filter((item) => item.kind === "footer");
  const skillsFooter = footerItems.find(
    (item) => item.kind === "footer" && item.section === "skills",
  );
  const pluginsFooter = footerItems.find(
    (item) => item.kind === "footer" && item.section === "plugins",
  );
  const hasMatches = skillItems.length > 0 || pluginItems.length > 0;

  return (
    <div
      className="navbar-search-typeahead"
      id="navbar-search-typeahead"
      role="listbox"
      aria-label={t("header.search_suggestions")}
    >
      <TypeaheadSection
        activeIndex={activeIndex}
        items={items}
        label={t("nav.skills")}
        sectionItems={skillItems}
        footer={skillsFooter}
        onHoverItem={onHoverItem}
        onSelectItem={onSelectItem}
      />
      <TypeaheadSection
        activeIndex={activeIndex}
        items={items}
        label={t("nav.plugins")}
        sectionItems={pluginItems}
        footer={pluginsFooter}
        onHoverItem={onHoverItem}
        onSelectItem={onSelectItem}
      />
      {loading && !hasMatches ? (
        <div className="navbar-search-typeahead-status">{t("header.searching")}</div>
      ) : null}
      {!loading && !hasMatches ? (
        <div className="navbar-search-typeahead-status">
          {t("header.search_no_results", { query })}
        </div>
      ) : null}
    </div>
  );
}

function TypeaheadSection({
  activeIndex,
  footer,
  items,
  label,
  onHoverItem,
  onSelectItem,
  sectionItems,
}: {
  activeIndex: number;
  footer: TypeaheadItem | undefined;
  items: TypeaheadItem[];
  label: string;
  onHoverItem: (index: number) => void;
  onSelectItem: (item: TypeaheadItem) => void;
  sectionItems: TypeaheadItem[];
}) {
  if (sectionItems.length === 0 && !footer) return null;
  return (
    <div className="navbar-search-typeahead-section">
      <div className="navbar-search-typeahead-heading">{label}</div>
      {sectionItems.map((item) => (
        <TypeaheadRow
          key={item.key}
          active={items[activeIndex]?.key === item.key}
          item={item}
          index={items.findIndex((candidate) => candidate.key === item.key)}
          onHoverItem={onHoverItem}
          onSelectItem={onSelectItem}
        />
      ))}
      {footer ? (
        <TypeaheadRow
          active={items[activeIndex]?.key === footer.key}
          item={footer}
          index={items.findIndex((candidate) => candidate.key === footer.key)}
          onHoverItem={onHoverItem}
          onSelectItem={onSelectItem}
        />
      ) : null}
    </div>
  );
}

function TypeaheadRow({
  active,
  index,
  item,
  onHoverItem,
  onSelectItem,
}: {
  active: boolean;
  index: number;
  item: TypeaheadItem;
  onHoverItem: (index: number) => void;
  onSelectItem: (item: TypeaheadItem) => void;
}) {
  const { t } = useLocale();
  const body = getTypeaheadRowBody(item, t);
  return (
    <button
      id={getTypeaheadOptionId(item)}
      className={`navbar-search-typeahead-row${active ? " is-active" : ""}${item.kind === "footer" ? " is-footer" : ""}`}
      type="button"
      role="option"
      aria-selected={active}
      onMouseEnter={() => onHoverItem(index)}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onSelectItem(item)}
    >
      {body.icon ? <span className="navbar-search-typeahead-icon">{body.icon}</span> : null}
      <span className="navbar-search-typeahead-copy">
        <span className="navbar-search-typeahead-title">{body.title}</span>
        {body.meta ? <span className="navbar-search-typeahead-meta">{body.meta}</span> : null}
      </span>
      {item.kind === "footer" ? <ArrowRight size={14} aria-hidden="true" /> : null}
    </button>
  );
}

function getTypeaheadOptionId(item: TypeaheadItem) {
  return `navbar-search-typeahead-${item.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function getTypeaheadRowBody(item: TypeaheadItem, t: ReturnType<typeof useLocale>["t"]) {
  if (item.kind === "skill") {
    const owner = item.result.ownerHandle ? `@${item.result.ownerHandle}` : t("nav.skills");
    return {
      icon: "S",
      title: item.result.skill.displayName,
      meta: `${owner} / ${item.result.skill.slug}`,
    };
  }
  if (item.kind === "plugin") {
    const owner = item.result.plugin.ownerHandle
      ? `@${item.result.plugin.ownerHandle} / ${item.result.plugin.name}`
      : item.result.plugin.name;
    return {
      icon: "P",
      title: item.result.plugin.displayName,
      meta: owner,
    };
  }
  return {
    icon: null,
    title: item.label,
    meta: null,
  };
}

function getCurrentRelativeUrl() {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function getThemeModeIcon(mode: "system" | "light" | "dark") {
  switch (mode) {
    case "light":
      return Sun;
    case "dark":
      return Moon;
    case "system":
    default:
      return Monitor;
  }
}
