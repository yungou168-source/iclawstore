/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PackageListItem } from "../lib/packageApi";
import { PluginListItem } from "./PluginListItem";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & ComponentPropsWithoutRef<"a">) => (
    <a href={to} {...props}>{children}</a>
  ),
}));

describe("PluginListItem", () => {
  it("renders official list plugins with the compact official mark", () => {
    render(<PluginListItem item={makePlugin()} />);

    expect(screen.getByLabelText("Official")).toBeTruthy();
    expect(screen.queryByText("Official")).toBeNull();
    expect(screen.queryByText("Verified")).toBeNull();
  });

  it("localizes plugin fallback metadata", () => {
    render(
      <PluginListItem
        item={{ ...makePlugin(), isOfficial: false, ownerHandle: undefined, summary: undefined }}
        locale="zh-CN"
      />,
    );

    expect(screen.getByLabelText("插件：Demo Plugin")).toBeTruthy();
    expect(screen.getByText("用于 Agent 工作流的插件包。")).toBeTruthy();
    expect(screen.getByText("插件")).toBeTruthy();
    expect(screen.getByText("社区")).toBeTruthy();
  });

  it("renders official plugin cards with the compact official mark", () => {
    render(<PluginListItem item={makePlugin()} variant="card" />);

    expect(screen.getByLabelText("Official")).toBeTruthy();
    expect(screen.queryByText("Official")).toBeNull();
    expect(screen.queryByText("Verified")).toBeNull();
  });
});

function makePlugin(): PackageListItem {
  return {
    name: "demo-plugin",
    displayName: "Demo Plugin",
    family: "code-plugin",
    channel: "official",
    isOfficial: true,
    summary: "Demo summary",
    ownerHandle: "local",
    createdAt: 1,
    updatedAt: 1,
    latestVersion: "1.0.0",
  };
}
