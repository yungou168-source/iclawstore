import { useAuthActions } from "@convex-dev/auth/react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  ChevronDown,
  LayoutDashboard,
  Menu,
  Monitor,
  Moon,
  Search,
  Settings,
  Star,
  Sun,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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

export default function Header() {
  const { locale } = useLocale();
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

  // Translation helper for nav items
  const getNavLabel = useMemo(() => {
    return (key: string): string => {
      const labelMap: Record<string, Record<string, string>> = {
        "zh-CN": {
          Skills: "技能",
          Plugins: "插件",
          Souls: "灵魂",
          Publishers: "发布者",
          Home: "首页",
        },
        en: {
          Skills: "Skills",
          Plugins: "Plugins",
          Souls: "Souls",
          Publishers: "Publishers",
          Home: "Home",
        },
      };
      return labelMap[locale]?.[key] ?? key;
    };
  }, [locale]);

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
        label: `See skill results for "${trimmedNavSearchQuery}"`,
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
        label: `See plugin results for "${trimmedNavSearchQuery}"`,
      });
    }
    return items;
  }, [pluginResults, showTypeahead, skillResults, trimmedNavSearchQuery]);
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
        <nav className="workspace-navbar-tabs" aria-label={locale === "zh-CN" ? "主导航" : "Primary navigation"}>
          <Link to="/" activeOptions={{ exact: true }}>
            {locale === "zh-CN" ? "首页" : "Home"}
          </Link>
          <Link to="/recruit-ai">
            {locale === "zh-CN" ? "招聘 AI 员工" : "Hire AI employees"}
          </Link>
          <Link to="/desktop-client">
            {locale === "zh-CN" ? "客户端下载" : "Desktop client"}
          </Link>
          {isAuthenticated && me ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="workspace-developer-trigger">
                  {locale === "zh-CN" ? "开发者" : "Developers"}
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem asChild>
                  <Link
                    to="/skills"
                    search={{ q: undefined, sort: undefined, dir: undefined, highlighted: undefined, view: undefined, focus: undefined }}
                  >
                    {locale === "zh-CN" ? "技能" : "Skills"}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/plugins">{locale === "zh-CN" ? "插件" : "Plugins"}</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </nav>
        <div className="workspace-navbar-actions">
          <LanguageSwitcher />
          {isAuthenticated && me ? (
            <Link to="/dashboard" className="workspace-account-link">
              {locale === "zh-CN" ? "工作台" : "Workspace"}
            </Link>
          ) : (
            <UnifiedSignInDialog
              locale={locale}
              disabled={isLoading || isAuthResolving}
              redirectTo={signInRedirectTo}
            />
          )}
          <a className="workspace-github-link" href={AI_WORK_REPOSITORY_URL} target="_blank" rel="noreferrer">
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
                aria-label="Open menu"
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
                  <SheetDescription>
                    {locale === "zh-CN"
                      ? "浏览分区、切换主题、访问账户操作。"
                      : "Browse sections, switch theme, and access account actions."}
                  </SheetDescription>
                </SheetHeader>
                <div className="mobile-nav-section">
                  <SheetClose asChild>
                    <Link to="/" className="mobile-nav-link">
                      {locale === "zh-CN" ? "首页" : "Home"}
                    </Link>
                  </SheetClose>
                  {isSoulMode ? (
                    <SheetClose asChild>
                      <a href={clawHubUrl} className="mobile-nav-link">
                        {locale === "zh-CN" ? "龙虾市场" : "ClawHub"}
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
                  <div className="mobile-nav-section-title">Theme</div>
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
                      ? locale === "zh-CN"
                        ? "跟随系统"
                        : "System theme"
                      : locale === "zh-CN"
                        ? `${mode === "light" ? "浅色" : "深色"}模式`
                        : `${mode} theme`}
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
              <img src="/ai-work-icon.svg?v=20260804-logo-fix" alt="" aria-hidden="true" className="brand-mark-image" />
            </span>
            <span className="brand-name brand-name-responsive">{siteName}</span>
          </Link>

          <div className="navbar-search-wrap" ref={searchWrapRef}>
            <form
              className="navbar-search"
              onSubmit={handleNavSearch}
              role="search"
              aria-label="Site search"
            >
              <Search size={16} className="navbar-search-icon" aria-hidden="true" />
              <input
                className="navbar-search-input"
                type="search"
                role="combobox"
                placeholder={
                  isSoulMode
                    ? locale === "zh-CN"
                      ? "搜索灵魂..."
                      : "Search souls..."
                    : locale === "zh-CN"
                      ? "搜索技能和插件"
                      : "Search skills and plugins"
                }
                value={navSearchQuery}
                onChange={(e) => {
                  setNavSearchQuery(e.target.value);
                  setTypeaheadOpen(true);
                }}
                onFocus={() => setTypeaheadOpen(true)}
                onKeyDown={handleSearchKeyDown}
                aria-label="Search"
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
              aria-label="Search"
              onClick={() => setMobileSearchOpen(!mobileSearchOpen)}
            >
              <Search size={18} aria-hidden="true" />
            </button>
            <div className="theme-toggle">
              <div className="theme-cycle-group" aria-label="Theme controls">
                <button
                  type="button"
                  className="theme-cycle-button theme-cycle-button-mode"
                  onClick={cycleThemeMode}
                  aria-label={`Cycle theme mode. Current: ${mode}`}
                  title={`Theme mode: ${mode}`}
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
                aria-label="Theme mode"
              >
                <ToggleGroupItem value="system" aria-label="System theme">
                  <Monitor className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">System</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="light" aria-label="Light theme">
                  <Sun className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Light</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="dark" aria-label="Dark theme">
                  <Moon className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Dark</span>
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            <LanguageSwitcher />
            {isAuthenticated && me ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="user-trigger" type="button">
                    {avatar ? (
                      <img src={avatar} alt={me.displayName ?? me.name ?? "User avatar"} />
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
                      {locale === "zh-CN" ? "仪表盘" : "Dashboard"}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/stars" className="flex items-center gap-2">
                      <Star size={14} aria-hidden="true" />
                      {locale === "zh-CN" ? "收藏" : "Stars"}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/settings" className="flex items-center gap-2">
                      <Settings size={14} aria-hidden="true" />
                      {locale === "zh-CN" ? "设置" : "Settings"}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void signOut()}>
                    {locale === "zh-CN" ? "退出登录" : "Sign out"}
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
                isSoulMode
                  ? locale === "zh-CN"
                    ? "搜索灵魂..."
                    : "Search souls..."
                  : locale === "zh-CN"
                    ? "搜索技能和插件"
                    : "Search skills and plugins"
              }
              value={navSearchQuery}
              onChange={(e) => setNavSearchQuery(e.target.value)}
              autoFocus
            />
          </form>
        ) : null}

        <nav className="navbar-tabs" aria-label="Content types">
          <div className="navbar-tabs-primary">
            {isSoulMode ? (
              <a href={clawHubUrl} className="navbar-tab">
                {locale === "zh-CN" ? "龙虾市场" : "ClawHub"}
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
      aria-label="Search suggestions"
    >
      <TypeaheadSection
        activeIndex={activeIndex}
        items={items}
        label="Skills"
        sectionItems={skillItems}
        footer={skillsFooter}
        onHoverItem={onHoverItem}
        onSelectItem={onSelectItem}
      />
      <TypeaheadSection
        activeIndex={activeIndex}
        items={items}
        label="Plugins"
        sectionItems={pluginItems}
        footer={pluginsFooter}
        onHoverItem={onHoverItem}
        onSelectItem={onSelectItem}
      />
      {loading && !hasMatches ? (
        <div className="navbar-search-typeahead-status">Searching...</div>
      ) : null}
      {!loading && !hasMatches ? (
        <div className="navbar-search-typeahead-status">
          No skills or plugins found for "{query}"
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
  const body = getTypeaheadRowBody(item);
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

function getTypeaheadRowBody(item: TypeaheadItem) {
  if (item.kind === "skill") {
    const owner = item.result.ownerHandle ? `@${item.result.ownerHandle}` : "Skill";
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
