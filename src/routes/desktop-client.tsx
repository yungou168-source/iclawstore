import { createFileRoute } from "@tanstack/react-router";
import { Apple, Download, MonitorDown, Terminal, type LucideIcon } from "lucide-react";
import { useLocale } from "../lib/i18n/context";

export const Route = createFileRoute("/desktop-client")({
  component: DesktopClientPage,
});

type DownloadGroup = {
  platform: string;
  description: string;
  icon: LucideIcon;
  downloads: Array<{ label: string; href: string }>;
};

const DOWNLOAD_GROUPS_ZH: DownloadGroup[] = [
  {
    platform: "Windows",
    description: "适用于 Windows 10 / 11",
    icon: MonitorDown,
    downloads: [
      { label: "Windows 64 位", href: "/downloads/desktop/windows/x64" },
      { label: "Windows 32 位", href: "/downloads/desktop/windows/x86" },
    ],
  },
  {
    platform: "macOS",
    description: "根据 Mac 处理器选择版本",
    icon: Apple,
    downloads: [
      { label: "Mac Apple 芯片", href: "/downloads/desktop/macos/arm64" },
      { label: "Mac Intel 芯片", href: "/downloads/desktop/macos/x64" },
    ],
  },
  {
    platform: "Linux",
    description: "提供主流发行版与处理器架构",
    icon: Terminal,
    downloads: [
      { label: "AppImage x64", href: "/downloads/desktop/linux/appimage-x64" },
      { label: "AppImage ARM64", href: "/downloads/desktop/linux/appimage-arm64" },
      { label: "Debian / Ubuntu x64", href: "/downloads/desktop/linux/deb-x64" },
      { label: "Debian / Ubuntu ARM64", href: "/downloads/desktop/linux/deb-arm64" },
      { label: "Fedora / RHEL x64", href: "/downloads/desktop/linux/rpm-x64" },
      { label: "Fedora / RHEL ARM64", href: "/downloads/desktop/linux/rpm-arm64" },
    ],
  },
];

const DOWNLOAD_GROUPS_EN: DownloadGroup[] = [
  {
    platform: "Windows",
    description: "For Windows 10 and 11",
    icon: MonitorDown,
    downloads: [
      { label: "Windows 64-bit", href: "/downloads/desktop/windows/x64" },
      { label: "Windows 32-bit", href: "/downloads/desktop/windows/x86" },
    ],
  },
  {
    platform: "macOS",
    description: "Choose the version for your Mac processor",
    icon: Apple,
    downloads: [
      { label: "Mac Apple silicon", href: "/downloads/desktop/macos/arm64" },
      { label: "Mac Intel", href: "/downloads/desktop/macos/x64" },
    ],
  },
  {
    platform: "Linux",
    description: "Packages for common distributions and architectures",
    icon: Terminal,
    downloads: [
      { label: "AppImage x64", href: "/downloads/desktop/linux/appimage-x64" },
      { label: "AppImage ARM64", href: "/downloads/desktop/linux/appimage-arm64" },
      { label: "Debian / Ubuntu x64", href: "/downloads/desktop/linux/deb-x64" },
      { label: "Debian / Ubuntu ARM64", href: "/downloads/desktop/linux/deb-arm64" },
      { label: "Fedora / RHEL x64", href: "/downloads/desktop/linux/rpm-x64" },
      { label: "Fedora / RHEL ARM64", href: "/downloads/desktop/linux/rpm-arm64" },
    ],
  },
];

function DesktopClientPage() {
  const { locale } = useLocale();
  const isEnglish = locale === "en";
  const downloadGroups = isEnglish ? DOWNLOAD_GROUPS_EN : DOWNLOAD_GROUPS_ZH;

  return (
    <main className="desktop-home">
      <section className="desktop-home-hero">
        <div className="desktop-home-grid" aria-hidden="true" />
        <div className="desktop-home-glow" aria-hidden="true" />
        <div className="desktop-home-container desktop-home-hero-content">
          <span className="desktop-home-badge">
            <MonitorDown size={15} /> {isEnglish ? "Desktop client" : "桌面客户端"}
          </span>
          <h1>
            {isEnglish ? (
              <>
                Assign work to AI employees with <strong>AI Direct Hiring</strong>
              </>
            ) : (
              <>
                招Ai员工,用<strong>AI直聘</strong>
              </>
            )}
          </h1>
          <div
            className="desktop-client-downloads"
            aria-label={isEnglish ? "Downloads" : "下载版本"}
          >
            {downloadGroups.map(({ platform, description, icon: PlatformIcon, downloads }) => (
              <section className="desktop-client-download-group" key={platform}>
                <div className="desktop-client-download-heading">
                  <span>
                    <PlatformIcon size={20} />
                  </span>
                  <div>
                    <h2>{platform}</h2>
                    <p>{description}</p>
                  </div>
                </div>
                <div className="desktop-client-download-links">
                  {downloads.map((download) => (
                    <a
                      className="desktop-home-button desktop-home-button-secondary"
                      href={download.href}
                      key={download.href}
                    >
                      <Download size={16} />
                      {download.label}
                    </a>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
