/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: (props: { children: ReactNode; to?: string }) => (
    <a href={props.to ?? "/"}>{props.children}</a>
  ),
}));

vi.mock("../lib/i18n/context", () => ({
  useLocale: () => ({ locale: "en" }),
}));

import { Footer } from "./Footer";

describe("Footer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockMatchMedia(matches: boolean) {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({
        matches,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  }

  it("renders friendly links, social icons, and the legal record information", () => {
    const { container } = render(<Footer />);

    expect(container.querySelectorAll(".footer-col")).toHaveLength(2);
    expect(screen.getByRole("region", { name: "Friendly links" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "AI直聘 desktop" }).getAttribute("href")).toBe(
      "https://github.com/yungou168-source/iclawstore",
    );
    expect(screen.getByRole("link", { name: "Desktop client" }).getAttribute("href")).toBe(
      "https://github.com/yungou168-source/iclawstore/releases",
    );
    expect(screen.getByRole("link", { name: "Source repository" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Issue tracker" })).toBeTruthy();
    expect(screen.getByText("© 2026 Ai Work. All rights reserved.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "苏ICP备2025218477号" }).getAttribute("href")).toBe(
      "https://beian.miit.gov.cn/",
    );
    expect(screen.getByRole("link", { name: "苏公网安备32072102010431号" }).getAttribute("href")).toBe(
      "https://www.beian.gov.cn/portal/registerSystemInfo?recordcode=32072102010431",
    );
  });

  it("collapses footer sections by heading until toggled open", async () => {
    mockMatchMedia(true);
    render(<Footer />);

    const browseToggle = screen.getByRole("button", { name: "Browse" });
    const browseLinks = document.getElementById("footer-section-browse-links");
    const developerToggle = screen.getByRole("button", { name: "Developers" });
    const developerLinks = document.getElementById("footer-section-developers-links");

    expect(browseLinks).not.toBeNull();
    expect(developerLinks).not.toBeNull();
    await waitFor(() => expect(browseToggle.getAttribute("aria-expanded")).toBe("false"));
    expect(browseLinks?.getAttribute("data-open")).toBe("false");
    expect(developerToggle.getAttribute("aria-expanded")).toBe("false");
    expect(developerLinks?.getAttribute("data-open")).toBe("false");

    fireEvent.click(browseToggle);

    expect(browseToggle.getAttribute("aria-expanded")).toBe("true");
    expect(browseLinks?.getAttribute("data-open")).toBe("true");
    expect(
      within(browseLinks as HTMLElement)
        .getByRole("link", { name: "Home" })
        .getAttribute("href"),
    ).toBe("/");
    expect(developerLinks?.getAttribute("data-open")).toBe("false");

    fireEvent.click(browseToggle);

    expect(browseToggle.getAttribute("aria-expanded")).toBe("false");
    expect(browseLinks?.getAttribute("data-open")).toBe("false");
  });
});
