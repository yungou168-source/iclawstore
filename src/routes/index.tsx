import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Code2,
  Download,
  Package,
  Search,
  Shield,
  Star,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SoulCard } from "../components/SoulCard";
import { HomeWorkspace } from "../components/HomeWorkspace";
import { SoulStatsTripletLine } from "../components/SoulStats";
import { fetchFeaturedPlugins } from "../lib/featuredCatalog";
import { FEATURE_SOULS } from "../lib/features";
import type { PackageListItem } from "../lib/packageApi";
import type { PublicSkill, PublicSoul, PublicUser } from "../lib/publicUser";
import { getSiteMode } from "../lib/site";
import { useLocale } from "../lib/i18n/context";
import { fastifyApi } from "../lib/fastifyApi";

export const Route = createFileRoute("/")({
  component: Home,
});

// Homepage translations
const HOME_TRANSLATIONS = {
  "zh-CN": {
    builtBy: "由社区构建。",
    equip: "装备",
    installLabel: "安装",
    unleash: "释放",
    subtitle: "数千款工具，一搜即得。",
    searchPlaceholder: "你想找什么？",
    searchButton: "搜索",
    featuredSkills: "精选技能",
    trendingNow: "热门趋势",
    featuredPlugins: "精选插件",
    viewAll: "查看全部",
    by: "作者",
    skill: "技能",
    official: "官方",
    unknown: "未知",
    tools: "工具",
    users: "用户",
    downloads: "下载",
    avgRating: "平均评分",
    categorySkills: "Agent 技能包",
    categoryPlugins: "网关插件",
    categoryPublishers: "建设者和组织",
    categorySouls: "Agent 身份",
    suggestion1: "自我改进代理",
    suggestion2: "GitHub 集成",
    suggestion3: "安全灵魂",
    suggestion4: "仪表盘构建器",
    // Souls mode
    soulsBadge: "SOUL.md，共享。",
    soulsTitle: "SoulHub，灵魂栖居之地。",
    soulsSubtitle: "分享 SOUL.md 包，像文档一样版本化管理，将个人系统 lore 集中保存在一个公共空间。",
    publishSoul: "发布灵魂",
    browseSouls: "浏览灵魂",
    searchPlaceholderSouls: "搜索灵魂、提示词或 lore",
    soulsSearchStat: "搜索灵魂。版本化管理、可读性强、易于改编。",
    latestSouls: "最新灵魂",
    latestSubtitle: "中心最新的 SOUL.md 包。",
    noSouls: "还没有灵魂。成为第一个吧。",
    seeAll: "查看所有灵魂",
    pluginsTitle: "寻找插件？",
    pluginsDesc: "插件目前位于更广泛的包模型中。使用专用插件页面可以更清晰地查看这项工作。",
    openPlugins: "打开插件",
    freshSkill: "新鲜的技能包。",
    agentReady: "Agent 就绪技能包。",
    // Slot word keys (used by renderSlotReel)
    slotEquip: "装备",
    slotInstall: "安装",
    slotUnleash: "释放",
    slotShip: "交付",
    slotBuild: "构建",
    slotCreate: "创建",
    slotDeploy: "部署",
    slotLaunch: "启动",
    slotHack: "Hack",
    slotScale: "扩展",
    slotForge: "锻造",
    slotCraft: "打磨",
    slotWield: "驾驭",
  },
  en: {
    builtBy: "BUILT BY THE COMMUNITY.",
    equip: "Equip",
    installLabel: "Install",
    unleash: "Unleash",
    subtitle: "Tools built by thousands, ready in one search.",
    searchPlaceholder: "What are you looking for?",
    searchButton: "Search",
    featuredSkills: "Featured skills",
    trendingNow: "Trending Now",
    featuredPlugins: "Featured plugins",
    viewAll: "View all",
    by: "by",
    skill: "Skill",
    official: "Official",
    unknown: "unknown",
    tools: "tools",
    users: "users",
    downloads: "downloads",
    avgRating: "avg rating",
    categorySkills: "Agent skill bundles",
    categoryPlugins: "Gateway plugins",
    categoryPublishers: "Builders and orgs",
    categorySouls: "Agent identities",
    suggestion1: "self-improving agent",
    suggestion2: "GitHub integration",
    suggestion3: "security soul",
    suggestion4: "dashboard builder",
    // Slot word keys (used by renderSlotReel)
    slotEquip: "Equip",
    slotInstall: "Install",
    slotUnleash: "Unleash",
    slotShip: "Ship",
    slotBuild: "Build",
    slotCreate: "Create",
    slotDeploy: "Deploy",
    slotLaunch: "Launch",
    slotHack: "Hack",
    slotScale: "Scale",
    slotForge: "Forge",
    slotCraft: "Craft",
    slotWield: "Wield",
    // Souls mode
    soulsBadge: "SOUL.md, shared.",
    soulsTitle: "SoulHub, where system lore lives.",
    soulsSubtitle:
      "Share SOUL.md bundles, version them like docs, and keep personal system lore in one public place.",
    publishSoul: "Publish a soul",
    browseSouls: "Browse souls",
    searchPlaceholderSouls: "Search souls, prompts, or lore",
    soulsSearchStat: "Search souls. Versioned, readable, easy to remix.",
    latestSouls: "Latest souls",
    latestSubtitle: "Newest SOUL.md bundles across the hub.",
    noSouls: "No souls yet. Be the first.",
    seeAll: "See all souls",
    pluginsTitle: "Looking for plugins?",
    pluginsDesc:
      "Plugins currently live inside the broader package model. Use the dedicated Plugins surface to review that work more clearly.",
    openPlugins: "Open Plugins",
    freshSkill: "A fresh skill bundle.",
    agentReady: "Agent-ready skill pack.",
  },
} as const;

function Home() {
  const { locale } = useLocale();
  const mode = getSiteMode();
  return mode === "souls" ? <OnlyCrabsHome locale={locale} /> : <HomeWorkspace />;
}

const SLOT_WORDS = [
  "Equip",
  "Install",
  "Unleash",
  "Ship",
  "Build",
  "Create",
  "Deploy",
  "Launch",
  "Hack",
  "Scale",
  "Forge",
  "Craft",
  "Wield",
];
const HACK_INDEX = SLOT_WORDS.indexOf("Hack");

export function LegacySkillsHome({ locale }: { locale: string }) {
  type SkillPageEntry = {
    skill: PublicSkill;
    ownerHandle?: string | null;
    owner?: PublicUser | null;
    latestVersion?: unknown;
  };

  // Translation helper
  const t = useMemo(
    () => (key: keyof (typeof HOME_TRANSLATIONS)["zh-CN"]) =>
      HOME_TRANSLATIONS[locale as keyof typeof HOME_TRANSLATIONS]?.[key] ??
      HOME_TRANSLATIONS["zh-CN"][key],
    [locale],
  );

  const [highlighted, setHighlighted] = useState<SkillPageEntry[]>([]);
  const [popular, setPopular] = useState<SkillPageEntry[]>([]);
  const [featuredPlugins, setFeaturedPlugins] = useState<PackageListItem[]>([]);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    
    // Fetch featured/highlighted skills
    fastifyApi.getSkills({ limit: 6, sort: "downloads" })
      .then((r) => {
        if (!cancelled) {
          const entries = r.skills.map((skill) => ({
            skill: {
              _id: skill.id, // Keep _id for compatibility
              id: skill.id,
              slug: skill.slug,
              displayName: skill.displayName,
              summary: skill.summary,
              stats: {
                downloads: skill.statsDownloads,
                stars: skill.statsStars,
                installsAllTime: skill.statsInstallsAllTime,
              },
            } as unknown as PublicSkill,
            ownerHandle: skill.owner?.handle ?? null,
            owner: skill.owner ?? null,
          }));
          setHighlighted(entries as SkillPageEntry[]);
        }
      })
      .catch(() => {});
    
    // Fetch popular skills
    fastifyApi.getSkills({ limit: 6, sort: "downloads" })
      .then((r) => {
        if (cancelled) return;
        const entries = r.skills.map((skill) => ({
          skill: {
            _id: skill.id,
            id: skill.id,
            slug: skill.slug,
            displayName: skill.displayName,
            summary: skill.summary,
            stats: {
              downloads: skill.statsDownloads,
              stars: skill.statsStars,
              installsAllTime: skill.statsInstallsAllTime,
            },
          } as unknown as PublicSkill,
          ownerHandle: skill.owner?.handle ?? null,
          owner: skill.owner ?? null,
        }));
        setPopular(entries as SkillPageEntry[]);
      })
      .catch(() => {});
      
    fetchFeaturedPlugins(6)
      .then((items) => {
        if (!cancelled) setFeaturedPlugins(items);
      })
      .catch(() => {});
      
    return () => {
      cancelled = true;
    };
  }, []);

  const trimmedQuery = useMemo(() => query.trim(), [query]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void navigate({
      to: "/search",
      search: { q: trimmedQuery || undefined },
    });
  };

  const handleSuggestion = (term: string) => {
    void navigate({
      to: "/search",
      search: { q: term },
    });
  };

  // Format stat numbers
  const formatStat = (n: number | undefined): string => {
    if (!n) return "0";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  };

  // Build skill detail link
  const skillLink = (entry: SkillPageEntry) =>
    `/${encodeURIComponent(entry.ownerHandle || entry.owner?.handle || entry.skill.ownerUserId)}/${entry.skill.slug}`;

  // Build carousel cards from highlighted data, then fall back to the public skill feed.
  const highlightedCarouselCards = highlighted.slice(0, 6);
  const fallbackCarouselCards = popular.slice(0, 6);
  const carouselCards =
    highlightedCarouselCards.length > 0 ? highlightedCarouselCards : fallbackCarouselCards;
  const carouselUsesHighlighted = highlightedCarouselCards.length > 0;
  const trendingCards = popular.slice(0, 6);
  const categoryCount = FEATURE_SOULS ? 4 : 3;
  const categoryLayout = categoryCount === 4 ? "1-2-4" : "1-3";

  const clickTimesRef = useRef<number[]>([]);
  const [slotState, setSlotState] = useState<
    | null
    | { phase: "spinning" }
    | { phase: "stopped"; results: [number, number, number]; won: boolean; isHackJackpot: boolean }
  >(null);
  const slotTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [slotReelOffsets, setSlotReelOffsets] = useState<[number, number, number]>([0, 0, 0]);
  const [stoppedReels, setStoppedReels] = useState<Set<number>>(new Set());
  const confettiRef = useRef<HTMLCanvasElement>(null);
  const spinIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cooldownUntilRef = useRef<number>(0);
  const carouselWrapRef = useRef<HTMLDivElement>(null);

  const scrollCarousel = (direction: -1 | 1) => {
    const carousel = carouselWrapRef.current;
    if (!carousel) return;

    const firstCard = carousel.querySelector<HTMLElement>(".home-v2-c-card");
    const scrollAmount = (firstCard?.offsetWidth ?? 320) + 16;
    if (typeof carousel.scrollBy === "function") {
      carousel.scrollBy({ left: direction * scrollAmount, behavior: "smooth" });
      return;
    }

    carousel.scrollLeft += direction * scrollAmount;
  };

  useEffect(() => {
    return () => {
      for (const timer of slotTimersRef.current) clearTimeout(timer);
      if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
    };
  }, []);

  const fireConfetti = useCallback((isHackJackpot: boolean) => {
    const canvas = confettiRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.display = "block";

    const standardColors = [
      "#d4453a",
      "#ff6b6b",
      "#ffd93d",
      "#6bcb77",
      "#4d96ff",
      "#ff6f91",
      "#845ec2",
      "#ffc75f",
    ];
    const oceanColors = [
      "#0ea5e9",
      "#06b6d4",
      "#14b8a6",
      "#22d3ee",
      "#38bdf8",
      "#67e8f9",
      "#a5f3fc",
      "#2dd4bf",
      "#d4453a",
      "#ff6b6b",
    ];
    const colors = isHackJackpot ? oceanColors : standardColors;

    type Particle = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      w: number;
      h: number;
      color: string;
      rot: number;
      vr: number;
      life: number;
      shape: "rect" | "bubble" | "claw";
    };
    const particles: Particle[] = [];
    const count = isHackJackpot ? 200 : 150;

    for (let i = 0; i < count; i++) {
      const isBubble = isHackJackpot && Math.random() < 0.35;
      const isClaw = isHackJackpot && !isBubble && Math.random() < 0.2;
      particles.push({
        x: canvas.width / 2 + (Math.random() - 0.5) * 300,
        y: canvas.height * 0.35,
        vx: (Math.random() - 0.5) * 18,
        vy: isHackJackpot ? -Math.random() * 14 - 2 + (isBubble ? -4 : 0) : -Math.random() * 16 - 4,
        w: isBubble ? Math.random() * 8 + 4 : Math.random() * 10 + 4,
        h: isBubble ? 0 : Math.random() * 6 + 3,
        color: colors[Math.floor(Math.random() * colors.length)] ?? colors[0],
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.3,
        life: isHackJackpot ? 1.3 : 1,
        shape: isClaw ? "claw" : isBubble ? "bubble" : "rect",
      });
    }

    const drawClaw = (context: CanvasRenderingContext2D, size: number) => {
      context.beginPath();
      context.moveTo(0, size * 0.5);
      context.quadraticCurveTo(-size * 0.6, size * 0.2, -size * 0.4, -size * 0.3);
      context.quadraticCurveTo(-size * 0.2, -size * 0.6, 0, -size * 0.3);
      context.quadraticCurveTo(size * 0.2, -size * 0.6, size * 0.4, -size * 0.3);
      context.quadraticCurveTo(size * 0.6, size * 0.2, 0, size * 0.5);
      context.closePath();
      context.fill();
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;
      for (const particle of particles) {
        if (particle.life <= 0) continue;
        alive = true;
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vy += particle.shape === "bubble" ? 0.15 : 0.4;
        particle.vx *= 0.99;
        particle.rot += particle.vr;
        particle.life -= isHackJackpot ? 0.005 : 0.008;
        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.rot);
        ctx.globalAlpha = Math.max(0, Math.min(1, particle.life));
        ctx.fillStyle = particle.color;

        if (particle.shape === "bubble") {
          ctx.beginPath();
          ctx.arc(0, 0, particle.w, 0, Math.PI * 2);
          ctx.strokeStyle = particle.color;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha *= 0.7;
          ctx.stroke();
          ctx.globalAlpha *= 0.15;
          ctx.fill();
        } else if (particle.shape === "claw") {
          drawClaw(ctx, particle.w);
        } else {
          ctx.fillRect(-particle.w / 2, -particle.h / 2, particle.w, particle.h);
        }
        ctx.restore();
      }

      if (alive) {
        requestAnimationFrame(draw);
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.display = "none";
    };

    requestAnimationFrame(draw);
  }, []);

  const triggerSlots = useCallback(() => {
    for (const timer of slotTimersRef.current) clearTimeout(timer);
    slotTimersRef.current = [];
    if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);

    setSlotState({ phase: "spinning" });
    setStoppedReels(new Set());

    let r0: number;
    let r1: number;
    let r2: number;
    const isJackpot = Math.random() < 1 / 25;

    if (isJackpot) {
      const isHackJackpot = Math.random() < 0.25;
      if (isHackJackpot) {
        r0 = HACK_INDEX;
      } else {
        let index = Math.floor(Math.random() * (SLOT_WORDS.length - 1));
        if (index >= HACK_INDEX) index++;
        r0 = index;
      }
      r1 = r0;
      r2 = r0;
    } else {
      let attempts = 0;
      do {
        r0 = Math.floor(Math.random() * SLOT_WORDS.length);
        r1 = Math.floor(Math.random() * SLOT_WORDS.length);
        r2 = Math.floor(Math.random() * SLOT_WORDS.length);
        attempts++;
      } while (r0 === r1 && r1 === r2 && attempts < 8);

      if (r0 === r1 && r1 === r2) {
        r1 = (r0 + 1) % SLOT_WORDS.length;
        r2 = (r0 + 2) % SLOT_WORDS.length;
      }
    }

    const results: [number, number, number] = [r0, r1, r2];
    const landed = new Set<number>();
    let frame = 0;
    const spinInterval = setInterval(() => {
      frame++;
      setSlotReelOffsets((previous) => [
        landed.has(0) ? previous[0] : (frame * 3) % SLOT_WORDS.length,
        landed.has(1) ? previous[1] : (frame * 5 + 4) % SLOT_WORDS.length,
        landed.has(2) ? previous[2] : (frame * 7 + 9) % SLOT_WORDS.length,
      ]);
    }, 60);
    spinIntervalRef.current = spinInterval;

    const stopReel = (reelIndex: 0 | 1 | 2, delay: number) => {
      const timer = setTimeout(() => {
        landed.add(reelIndex);
        setStoppedReels((previous) => new Set(previous).add(reelIndex));
        setSlotReelOffsets((previous) => {
          const next = [...previous] as [number, number, number];
          next[reelIndex] = results[reelIndex];
          return next;
        });
      }, delay);
      slotTimersRef.current.push(timer);
    };

    stopReel(0, 1200);
    stopReel(1, 1800);

    const finalTimer = setTimeout(() => {
      clearInterval(spinInterval);
      spinIntervalRef.current = null;
      landed.add(2);
      setStoppedReels(new Set([0, 1, 2]));
      setSlotReelOffsets(results);
      const won = r0 === r1 && r1 === r2;
      const isHackJackpot = won && r0 === HACK_INDEX;
      setSlotState({ phase: "stopped", results, won, isHackJackpot });
      if (won) fireConfetti(isHackJackpot);

      const displayTime = won ? 10000 : 2400;
      const cooldownTime = won ? 18000 : 3000;
      cooldownUntilRef.current = Date.now() + cooldownTime;
      const resetTimer = setTimeout(() => {
        setSlotState(null);
        setStoppedReels(new Set());
      }, displayTime);
      slotTimersRef.current.push(resetTimer);
    }, 2400);
    slotTimersRef.current.push(finalTimer);
  }, [fireConfetti]);

  const handleLabelClick = useCallback(() => {
    const now = Date.now();
    if (now < cooldownUntilRef.current) return;
    clickTimesRef.current.push(now);
    if (clickTimesRef.current.length > 3) {
      clickTimesRef.current = clickTimesRef.current.slice(-3);
    }
    if (clickTimesRef.current.length !== 3) return;

    const first = clickTimesRef.current[0] ?? 0;
    const last = clickTimesRef.current[2] ?? 0;
    if (last - first < 800 && !slotState) {
      clickTimesRef.current = [];
      triggerSlots();
    }
  }, [slotState, triggerSlots]);

  // Translated slot words based on locale
  const slotWords = useMemo(
    () => [
      t("slotEquip"),
      t("slotInstall"),
      t("slotUnleash"),
      t("slotShip"),
      t("slotBuild"),
      t("slotCreate"),
      t("slotDeploy"),
      t("slotLaunch"),
      t("slotHack"),
      t("slotScale"),
      t("slotForge"),
      t("slotCraft"),
      t("slotWield"),
    ],
    [t],
  );

  const renderSlotReel = (reelIndex: 0 | 1 | 2) => {
    const offset = slotReelOffsets[reelIndex];
    const word = slotWords[offset] ?? slotWords[0];
    const isReelSpinning = slotState !== null && !stoppedReels.has(reelIndex);
    return (
      <span className={`home-v2-slot-reel ${isReelSpinning ? "spinning" : ""}`}>
        <span className="home-v2-slot-word">{word}</span>
      </span>
    );
  };

  return (
    <main className="home-v2-main">
      <canvas ref={confettiRef} className="home-v2-confetti" style={{ display: "none" }} />

      {/* ═══ HERO ═══ */}
      <section className="home-v2-hero">
        <div className="home-v2-hero-bg">
          <div className="home-v2-glow" />
          <div className="home-v2-dots" />
          <div className="home-v2-ring home-v2-ring-1" />
          <div className="home-v2-ring home-v2-ring-2" />
          <div className="home-v2-ring home-v2-ring-3" />
        </div>

        <button
          className={`home-v2-hero-label ${slotState ? "home-v2-hero-label-active" : ""}`}
          type="button"
          onClick={handleLabelClick}
        >
          {t("builtBy")}
        </button>

        {slotState ? (
          <h1
            className={`home-v2-headline home-v2-headline-slots${
              slotState.phase === "stopped" && slotState.won
                ? slotState.isHackJackpot
                  ? " home-v2-headline-jackpot home-v2-headline-hack"
                  : " home-v2-headline-jackpot"
                : ""
            }`}
          >
            {slotState.phase === "stopped" && slotState.isHackJackpot ? (
              <img
                src="/clawd-mark.png"
                alt=""
                aria-hidden="true"
                className="home-v2-hack-lobster"
              />
            ) : null}
            <span className="home-v2-headline-inner">
              {renderSlotReel(0)}
              <span className="home-v2-sep" />
              {renderSlotReel(1)}
              <span className="home-v2-sep" />
              {renderSlotReel(2)}
            </span>
          </h1>
        ) : (
          <h1 className="home-v2-headline">
            <span className="home-v2-headline-inner">
              <span className="home-v2-action-word">{t("slotEquip")}</span>
              <span className="home-v2-sep" />
              <span className="home-v2-action-word">{t("slotInstall")}</span>
              <span className="home-v2-sep" />
              <span className="home-v2-cycle-wrap">
                <span className="home-v2-cycle-track">
                  <span className="home-v2-cycle-word">{t("slotUnleash")}.</span>
                  <span className="home-v2-cycle-word">{t("slotShip")}.</span>
                  <span className="home-v2-cycle-word">{t("slotBuild")}.</span>
                  <span className="home-v2-cycle-word">{t("slotCreate")}.</span>
                  <span className="home-v2-cycle-word">{t("slotUnleash")}.</span>
                </span>
              </span>
            </span>
          </h1>
        )}

        <p className="home-v2-sub">{t("subtitle")}</p>

        <div className="home-v2-search-container">
          <form className="home-v2-search-bar" onSubmit={handleSearch}>
            <Search className="home-v2-search-icon" size={20} />
            <input
              autoFocus
              type="text"
              placeholder={t("searchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="submit" className="home-v2-search-go" aria-label="Search">
              <span className="home-v2-search-go-label">{t("searchButton")}</span> <ArrowRight size={16} />
            </button>
          </form>
        </div>

        <div className="home-v2-suggestions">
          <button
            type="button"
            className="home-v2-suggestion"
            onClick={() => handleSuggestion(t("suggestion1"))}
          >
            {t("suggestion1")}
          </button>
          <button
            type="button"
            className="home-v2-suggestion"
            onClick={() => handleSuggestion(t("suggestion2"))}
          >
            {t("suggestion2")}
          </button>
          <button
            type="button"
            className="home-v2-suggestion"
            onClick={() => handleSuggestion(t("suggestion3"))}
          >
            {t("suggestion3")}
          </button>
          <button
            type="button"
            className="home-v2-suggestion"
            onClick={() => handleSuggestion(t("suggestion4"))}
          >
            {t("suggestion4")}
          </button>
        </div>
      </section>

      {/* ═══ FEATURED CAROUSEL ═══ */}
      {carouselCards.length > 0 && (
        <section
          className="home-v2-carousel-section"
          data-source={carouselUsesHighlighted ? "highlighted" : "popular"}
        >
          <div className="home-v2-carousel-header">
            <h2>{t("featuredSkills")}</h2>
            <div className="home-v2-carousel-controls">
              <Link
                to="/skills"
                search={
                  carouselUsesHighlighted
                    ? {
                        q: undefined,
                        sort: undefined,
                        dir: undefined,
                        featured: true,
                        highlighted: undefined,
                        view: undefined,
                        focus: undefined,
                      }
                    : {
                        q: undefined,
                        sort: undefined,
                        dir: undefined,
                        featured: undefined,
                        highlighted: undefined,
                        view: undefined,
                        focus: undefined,
                      }
                }
                className="home-v2-section-link"
              >
                {t("viewAll")} <ArrowRight size={14} />
              </Link>
              <button
                type="button"
                className="home-v2-carousel-btn"
                aria-label="Previous"
                onClick={() => scrollCarousel(-1)}
              >
                <ArrowLeft size={16} />
              </button>
              <button
                type="button"
                className="home-v2-carousel-btn"
                aria-label="Next"
                onClick={() => scrollCarousel(1)}
              >
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
          <div className="home-v2-carousel-wrap" ref={carouselWrapRef}>
            <div className="home-v2-carousel-track">
              {/* First pass */}
              {carouselCards.map((entry) => (
                <Link
                  key={`c1-${entry.skill._id}`}
                  to={skillLink(entry)}
                  className="home-v2-c-card"
                >
                  <div className="home-v2-c-head">
                    <div className="home-v2-c-meta">
                      <div className="home-v2-c-name">
                        {entry.skill.displayName || entry.skill.slug}
                      </div>
                      <div className="home-v2-c-by">
                        {t("by")} {entry.ownerHandle || entry.owner?.handle || t("unknown")}
                      </div>
                    </div>
                  </div>
                  <span className="home-v2-c-tag">{t("skill")}</span>
                  <div className="home-v2-c-desc">
                    {entry.skill.summary || t("freshSkill")}
                  </div>
                  <div className="home-v2-c-footer">
                    <div className="home-v2-c-stats">
                      <span>
                        <Star size={12} /> {formatStat(entry.skill.stats?.stars)}
                      </span>
                      <span>
                        <Download size={12} /> {formatStat(entry.skill.stats?.downloads)}
                      </span>
                    </div>
                    <span className="home-v2-c-install">
                      <Download size={13} /> {t("installLabel")}
                    </span>
                  </div>
                </Link>
              ))}
              {/* Duplicate for seamless loop */}
              {carouselCards.map((entry) => (
                <Link
                  key={`c2-${entry.skill._id}`}
                  to={skillLink(entry)}
                  className="home-v2-c-card"
                >
                  <div className="home-v2-c-head">
                    <div className="home-v2-c-meta">
                      <div className="home-v2-c-name">
                        {entry.skill.displayName || entry.skill.slug}
                      </div>
                      <div className="home-v2-c-by">
                        {t("by")} {entry.ownerHandle || entry.owner?.handle || t("unknown")}
                      </div>
                    </div>
                  </div>
                  <span className="home-v2-c-tag">{t("skill")}</span>
                  <div className="home-v2-c-desc">
                    {entry.skill.summary || t("freshSkill")}
                  </div>
                  <div className="home-v2-c-footer">
                    <div className="home-v2-c-stats">
                      <span>
                        <Star size={12} /> {formatStat(entry.skill.stats?.stars)}
                      </span>
                      <span>
                        <Download size={12} /> {formatStat(entry.skill.stats?.downloads)}
                      </span>
                    </div>
                    <span className="home-v2-c-install">
                      <Download size={13} /> {t("installLabel")}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ═══ CATEGORIES ═══ */}
      <section className="home-v2-categories">
        <div
          className="home-v2-categories-grid"
          data-count={categoryCount}
          data-layout={categoryLayout}
        >
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
            className="home-v2-cat-item"
          >
            <div className="home-v2-cat-icon">
              <Package size={20} />
            </div>
            <div className="home-v2-cat-text">
              <div className="home-v2-cat-name">{t("categorySkills").split(" ")[0]}</div>
              <div className="home-v2-cat-desc">{t("categorySkills")}</div>
            </div>
            <span className="home-v2-cat-arrow">
              <ChevronRight size={16} />
            </span>
          </Link>
          <Link to="/plugins" className="home-v2-cat-item">
            <div className="home-v2-cat-icon">
              <Code2 size={20} />
            </div>
            <div className="home-v2-cat-text">
              <div className="home-v2-cat-name">{locale === "zh-CN" ? "插件" : "Plugins"}</div>
              <div className="home-v2-cat-desc">{t("categoryPlugins")}</div>
            </div>
            <span className="home-v2-cat-arrow">
              <ChevronRight size={16} />
            </span>
          </Link>
          <Link to="/publishers" className="home-v2-cat-item">
            <div className="home-v2-cat-icon">
              <Users size={20} />
            </div>
            <div className="home-v2-cat-text">
              <div className="home-v2-cat-name">{locale === "zh-CN" ? "发布者" : "Publishers"}</div>
              <div className="home-v2-cat-desc">{t("categoryPublishers")}</div>
            </div>
            <span className="home-v2-cat-arrow">
              <ChevronRight size={16} />
            </span>
          </Link>
          {FEATURE_SOULS ? (
            <Link
              to="/souls"
              search={{
                q: undefined,
                sort: undefined,
                dir: undefined,
                view: undefined,
                focus: undefined,
              }}
              className="home-v2-cat-item"
            >
              <div className="home-v2-cat-icon">
                <Shield size={20} />
              </div>
              <div className="home-v2-cat-text">
                <div className="home-v2-cat-name">{locale === "zh-CN" ? "灵魂" : "Souls"}</div>
                <div className="home-v2-cat-desc">{t("categorySouls")}</div>
              </div>
              <span className="home-v2-cat-arrow">
                <ChevronRight size={16} />
              </span>
            </Link>
          ) : null}
        </div>
      </section>

      {/* ═══ PROOF BAR ═══ */}
      <div className="home-v2-proof-bar">
        <div className="home-v2-proof-item">
          <span className="home-v2-proof-num">52.7k</span>
          <span className="home-v2-proof-label">{t("tools")}</span>
        </div>
        <span className="home-v2-proof-sep" />
        <div className="home-v2-proof-item">
          <span className="home-v2-proof-num">180k</span>
          <span className="home-v2-proof-label">{t("users")}</span>
        </div>
        <span className="home-v2-proof-sep" />
        <div className="home-v2-proof-item">
          <span className="home-v2-proof-num">12M</span>
          <span className="home-v2-proof-label">{t("downloads")}</span>
        </div>
        <span className="home-v2-proof-sep" />
        <div className="home-v2-proof-item">
          <span className="home-v2-proof-num">4.8</span>
          <span className="home-v2-proof-label">{t("avgRating")}</span>
        </div>
      </div>

      {/* ═══ TRENDING ═══ */}
      {trendingCards.length > 0 && (
        <section className="home-v2-trending-section">
          <div className="home-v2-section-header">
            <h2>{t("trendingNow")}</h2>
            <Link
              to="/skills"
              search={{
                q: undefined,
                sort: undefined,
                dir: undefined,
                featured: undefined,
                highlighted: undefined,
                view: undefined,
                focus: undefined,
              }}
              className="home-v2-section-link"
            >
              {t("viewAll")} <ArrowRight size={14} />
            </Link>
          </div>
          <div className="home-v2-trending-grid">
            {trendingCards.map((entry) => (
              <Link key={entry.skill._id} to={skillLink(entry)} className="home-v2-trend-card">
                <div className="home-v2-trend-head">
                  <div className="home-v2-trend-title">
                    {entry.skill.displayName || entry.skill.slug}
                  </div>
                  <div className="home-v2-trend-creator">
                    {t("by")} {entry.ownerHandle || entry.owner?.handle || t("unknown")}
                  </div>
                </div>
                <div className="home-v2-trend-desc">
                  {entry.skill.summary || t("agentReady")}
                </div>
                <div className="home-v2-trend-bottom">
                  <div className="home-v2-trend-signals">
                    <span>
                      <Star size={12} /> {formatStat(entry.skill.stats?.stars)}
                    </span>
                    <span>
                      <Download size={12} /> {formatStat(entry.skill.stats?.downloads)}
                    </span>
                  </div>
                  <span className="home-v2-trend-install">
                    <Download size={13} /> {t("installLabel")}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ═══ FEATURED PLUGINS ═══ */}
      {featuredPlugins.length > 0 && (
        <section className="home-v2-trending-section">
          <div className="home-v2-section-header">
            <h2>{t("featuredPlugins")}</h2>
            <Link
              to="/plugins"
              search={{
                q: undefined,
                cursor: undefined,
                family: undefined,
                featured: true,
                official: undefined,
                executesCode: undefined,
              }}
              className="home-v2-section-link"
            >
              {t("viewAll")} <ArrowRight size={14} />
            </Link>
          </div>
          <div className="home-v2-trending-grid">
            {featuredPlugins.slice(0, 6).map((plugin) => (
              <Link
                key={plugin.name}
                to="/plugins/$name"
                params={{ name: plugin.name }}
                className="home-v2-trend-card"
              >
                <div className="home-v2-trend-head">
                  <div className="home-v2-trend-title">{plugin.displayName || plugin.name}</div>
                  <div className="home-v2-trend-creator">
                    {plugin.ownerHandle
                      ? `${locale === "zh-CN" ? "作者" : "by"} @${plugin.ownerHandle}`
                      : locale === "zh-CN"
                        ? "社区插件"
                        : "community plugin"}
                  </div>
                </div>
                <div className="home-v2-trend-desc">
                  {plugin.summary ||
                    (locale === "zh-CN" ? "OpenClaw 工作流网关插件。" : "Gateway plugin for OpenClaw workflows.")}
                </div>
                <div className="home-v2-trend-bottom">
                  <div className="home-v2-trend-signals">
                    {plugin.isOfficial ? <span>{t("official")}</span> : null}
                    {plugin.latestVersion ? <span>v{plugin.latestVersion}</span> : null}
                  </div>
                  <span className="home-v2-trend-install">
                    <Download size={13} /> {t("installLabel")}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function OnlyCrabsHome({ locale }: { locale: string }) {
  const t = useMemo(
    () => (key: keyof (typeof HOME_TRANSLATIONS)["zh-CN"]) =>
      HOME_TRANSLATIONS[locale as keyof typeof HOME_TRANSLATIONS]?.[key] ??
      HOME_TRANSLATIONS["zh-CN"][key],
    [locale],
  );
  const navigate = Route.useNavigate();
  const [latest, setLatest] = useState<PublicSoul[]>([]);
  const [query, setQuery] = useState("");
  const trimmedQuery = useMemo(() => query.trim(), [query]);

  useEffect(() => {
    let cancelled = false;
    // Souls are fetched via Fastify API
    fetch("/api/souls")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data)) {
          setLatest(data.slice(0, 12) as PublicSoul[]);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      <section className="hero">
        <div className="hero-inner">
          <div className="hero-copy fade-up" data-delay="1">
            <span className="hero-badge">{t("soulsBadge")}</span>
            <h1 className="hero-title">{t("soulsTitle")}</h1>
            <p className="hero-subtitle">{t("soulsSubtitle")}</p>
            <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
              <Link
                to="/upload"
                search={{ updateSlug: undefined, ownerHandle: undefined }}
                className="btn btn-primary"
              >
                {t("publishSoul")}
              </Link>
              <Link
                to="/souls"
                search={{
                  q: undefined,
                  sort: undefined,
                  dir: undefined,
                  view: undefined,
                  focus: undefined,
                }}
                className="btn"
              >
                {t("browseSouls")}
              </Link>
            </div>
          </div>
          <div className="hero-card hero-search-card fade-up" data-delay="2">
            <form
              className="search-bar"
              onSubmit={(event) => {
                event.preventDefault();
                void navigate({
                  to: "/souls",
                  search: {
                    q: trimmedQuery || undefined,
                    sort: undefined,
                    dir: undefined,
                    view: undefined,
                    focus: undefined,
                  },
                });
              }}
            >
              <span className="mono">/</span>
              <input
                className="search-input"
                placeholder={t("searchPlaceholderSouls")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </form>
            <div className="hero-install" style={{ marginTop: 18 }}>
              <div className="stat">{t("soulsSearchStat")}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">{t("latestSouls")}</h2>
        <p className="section-subtitle">{t("latestSubtitle")}</p>
        <div className="grid">
          {latest.length === 0 ? (
            <div className="card">{t("noSouls")}</div>
          ) : (
            latest.map((soul) => (
              <SoulCard
                key={soul._id}
                soul={soul}
                summaryFallback={locale === "zh-CN" ? "一个 SOUL.md 包。" : "A SOUL.md bundle."}
                meta={
                  <div className="stat">
                    <SoulStatsTripletLine stats={soul.stats} />
                  </div>
                }
              />
            ))
          )}
        </div>
        <div className="section-cta">
          <Link
            to="/souls"
            search={{
              q: undefined,
              sort: undefined,
              dir: undefined,
              view: undefined,
              focus: undefined,
            }}
            className="btn"
          >
            {t("seeAll")}
          </Link>
        </div>
      </section>

      <section className="mx-auto mt-6 w-full max-w-screen-xl px-4 md:px-6">
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-white shadow-sm">
          <div className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-red-200">
            {locale === "zh-CN" ? "插件" : "Plugins"}
          </div>
          <div className="text-lg font-semibold">{t("pluginsTitle")}</div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/75">{t("pluginsDesc")}</p>
          <div className="mt-4">
            <Link
              to="/plugins"
              className="inline-flex items-center rounded-xl bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/90"
            >
              {t("openPlugins")}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
