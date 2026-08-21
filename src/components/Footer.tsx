import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { friendlyLinksApi } from "../lib/friendlyLinksApi";
import { useLocale } from "../lib/i18n/context";
import { AI_WORK_REPOSITORY_URL, FOOTER_NAV_SECTIONS } from "../lib/nav-items";

function sectionId(title: string) {
  return `footer-section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

// Must match the `@media (max-width: 760px)` breakpoint in styles.css where
// `.footer-col-links` is hidden by default and shown only when [data-open="true"].
const MOBILE_BREAKPOINT = 760;

const FOOTER_LABEL_KEYS = {
  Browse: "footer.browse",
  Home: "nav.home",
  "Hire AI employees": "header.hire_ai_employees",
  "Desktop client": "header.desktop_client",
  Developers: "footer.developers",
  Skills: "nav.skills",
  Plugins: "nav.plugins",
  "Friendly links": "footer.friendly_links",
  AI直聘桌面端: "footer.desktop_client",
  "Source repository": "footer.source_repository",
  "Issue tracker": "footer.issue_tracker",
  copyright: "footer.copyright",
} as const;

const FRIENDLY_LINKS: ReadonlyArray<{ label: string; href: string }> = [
  { label: "AI直聘桌面端", href: AI_WORK_REPOSITORY_URL },
  { label: "agency-agents-zh", href: "https://github.com/jnMetaCode/agency-agents-zh" },
];

export function Footer() {
  const { t } = useLocale();
  const [openSections, setOpenSections] = useState<ReadonlySet<string>>(() => new Set());
  const [friendlyLinks, setFriendlyLinks] = useState(FRIENDLY_LINKS);
  // Track whether the mobile disclosure behavior is active so aria-expanded matches
  // actual link visibility. Initialized to false (= desktop assumption) so that
  // SSR and the first client render agree: on desktop links are always visible and
  // aria-expanded=true is correct. On mobile, useEffect corrects this after hydration.
  const [isMobile, setIsMobile] = useState(false);

  const translate = useMemo(
    () => (label: string) =>
      label in FOOTER_LABEL_KEYS
        ? t(FOOTER_LABEL_KEYS[label as keyof typeof FOOTER_LABEL_KEYS])
        : label,
    [t],
  );

  // Translated footer sections
  const translatedSections = useMemo(
    () =>
      FOOTER_NAV_SECTIONS.map((section) => ({
        ...section,
        title: translate(section.title),
        items: section.items.map((item) => ({
          ...item,
          label: translate(item.label),
        })),
      })),
    [translate],
  );

  useEffect(() => {
    let active = true;
    void friendlyLinksApi
      .listPublic()
      .then(({ items }) => {
        if (active) {
          setFriendlyLinks(items.map((item) => ({ label: item.label, href: item.url })));
        }
      })
      .catch(() => {
        // Keep the deployment-safe defaults while the API or migration is unavailable.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      setIsMobile(false);
      return () => {};
    }

    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const toggleSection = (title: string) => {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  };

  return (
    <footer className="site-footer" role="contentinfo">
      <div className="site-footer-inner">
        <section className="footer-friendly-links" aria-label={translate("Friendly links")}>
          <span>{translate("Friendly links")}</span>
          <div>
            {friendlyLinks.map((link) => (
              <a key={link.href} href={link.href} target="_blank" rel="noreferrer">
                {translate(link.label)}
              </a>
            ))}
          </div>
        </section>
        <div className="footer-grid">
          {translatedSections.map((section) => {
            const isOpen = openSections.has(section.title);
            const id = sectionId(section.title);
            // On desktop the links are always visible; aria-expanded must be true.
            // On mobile the links are hidden/shown via the disclosure button.
            const ariaExpanded = isMobile ? isOpen : true;

            return (
              <div key={section.title} className="footer-col">
                <h4 className="footer-col-title">
                  <button
                    type="button"
                    className="footer-col-toggle"
                    aria-controls={`${id}-links`}
                    aria-expanded={ariaExpanded}
                    onClick={() => {
                      if (isMobile) toggleSection(section.title);
                    }}
                  >
                    <span>{section.title}</span>
                    <ChevronDown className="footer-col-toggle-icon" size={16} aria-hidden="true" />
                  </button>
                </h4>
                <div className="footer-col-links" id={`${id}-links`} data-open={isOpen}>
                  {section.items
                    .filter((item) => item.featureFlag !== false)
                    .map((item) => {
                      if (item.kind === "link") {
                        return (
                          <Link
                            key={item.label}
                            to={item.to}
                            search={item.search ?? {}}
                            hash={item.hash}
                          >
                            {item.label}
                          </Link>
                        );
                      }
                      if (item.kind === "external") {
                        return (
                          <a key={item.label} href={item.href} target="_blank" rel="noreferrer">
                            {item.label}
                          </a>
                        );
                      }
                      return <span key={item.label}>{item.label}</span>;
                    })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="footer-social-links" aria-label={t("footer.social_links")}>
          <a
            href={AI_WORK_REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
            aria-label={translate("Source repository")}
            title={translate("Source repository")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.61-3.37-1.18-3.37-1.18-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.54 1.04 1.54 1.04.9 1.53 2.35 1.09 2.92.84.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02A9.6 9.6 0 0 1 12 6.8c.85 0 1.7.11 2.5.34 1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.9.68 1.81v2.68c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"
                fill="currentColor"
              />
            </svg>
          </a>
          <a
            href={`${AI_WORK_REPOSITORY_URL}/issues`}
            target="_blank"
            rel="noreferrer"
            aria-label={translate("Issue tracker")}
            title={translate("Issue tracker")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9Zm0 15.5a1.25 1.25 0 1 1 1.25-1.25A1.25 1.25 0 0 1 12 18.5Zm1.45-5.63c-.8.48-.95.69-.95 1.38v.25h-1.5v-.42c0-1.29.45-1.92 1.42-2.49.84-.5 1.18-.85 1.18-1.56a1.6 1.6 0 0 0-3.19 0H8.9a3.1 3.1 0 0 1 6.2 0c0 1.35-.65 2.14-1.65 2.84Z"
                fill="currentColor"
              />
            </svg>
          </a>
        </div>
        <div className="footer-legal">
          <span>{translate("copyright")}</span>
          <span className="footer-record-links">
            <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">
              苏ICP备2025218477号
            </a>
            <a
              href="https://www.beian.gov.cn/portal/registerSystemInfo?recordcode=32072102010431"
              target="_blank"
              rel="noreferrer"
            >
              苏公网安备32072102010431号
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
