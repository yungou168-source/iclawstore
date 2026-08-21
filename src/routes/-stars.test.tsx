/* @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../lib/i18n/context";
import { Stars } from "./stars";

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const useAuthStatusMock = vi.fn();
const useAuthActionsMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => useAuthActionsMock(),
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => useAuthStatusMock(),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    createFileRoute: () => (options: unknown) => ({
      ...(options as Record<string, unknown>),
      useNavigate: () => navigateMock,
      useSearch: () => ({}),
    }),
    Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  };
});

function makeSkill(params: { _id: string; slug: string; displayName: string; summary?: string }) {
  return {
    _id: params._id,
    _creationTime: Date.now(),
    slug: params.slug,
    displayName: params.displayName,
    summary: params.summary ?? null,
    ownerUserId: "user_123",
    ownerPublisherId: null,
    canonicalSkillId: null,
    forkOf: null,
    latestVersionId: null,
    tags: [],
    capabilityTags: [],
    badges: null,
    stats: { stars: 5, downloads: 12, versions: 1, comments: 0 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe("Stars", () => {
  const toggleStarMock = vi.fn();

  beforeEach(() => {
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    useAuthStatusMock.mockReset();
    useAuthActionsMock.mockReset();
    navigateMock.mockReset();
    useMutationMock.mockReturnValue(toggleStarMock);
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "user_123" },
    });
    useAuthActionsMock.mockReturnValue({ signIn: vi.fn() });
    toggleStarMock.mockReset();
    toggleStarMock.mockResolvedValue(null);
  });

  it("shows sign-in prompt when user is not authenticated", () => {
    useAuthStatusMock.mockReturnValue({ isAuthenticated: false, isLoading: false, me: null });
    useQueryMock.mockImplementation((_query, args) => {
      if (args === "skip") return undefined;
      return undefined;
    });

    render(
      <I18nProvider>
        <Stars />
      </I18nProvider>,
    );

    expect(screen.getByText("Sign in to see your highlights")).toBeTruthy();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy();
  });

  it("shows skeleton while loading", () => {
    useAuthStatusMock.mockReturnValue({ isAuthenticated: false, isLoading: true, me: undefined });
    useQueryMock.mockImplementation((_query, args) => {
      if (args === "skip") return undefined;
      return undefined;
    });

    render(
      <I18nProvider>
        <Stars />
      </I18nProvider>,
    );

    expect(document.querySelector(".skeleton-list")).toBeTruthy();
    expect(screen.queryByText("No stars yet")).toBeNull();
  });

  it("shows empty state when user has no stars", () => {
    useQueryMock.mockImplementation((_query, args) => {
      if (args === "skip") return undefined;
      return [];
    });

    render(
      <I18nProvider>
        <Stars />
      </I18nProvider>,
    );

    expect(screen.getByText("暂无收藏")).toBeTruthy();
    expect(screen.getByRole("link", { name: "浏览技能" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Sort starred skills" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Grid view" })).toBeNull();
    expect(screen.queryByRole("link", { name: "List view" })).toBeNull();
  });

  it("renders skill cards when user has stars", () => {
    useQueryMock.mockImplementation((_query, args) => {
      if (args === "skip") return undefined;
      return [makeSkill({ _id: "skill_1", slug: "test-skill", displayName: "Test Skill" })];
    });

    render(
      <I18nProvider>
        <Stars />
      </I18nProvider>,
    );

    expect(screen.getByRole("heading", { name: "Test Skill" })).toBeTruthy();
    expect(screen.getByLabelText("Unstar Test Skill")).toBeTruthy();
    expect(screen.getByText("Test Skill")).toBeTruthy();
  });

  it("calls toggleStar when unstar button is clicked", () => {
    const skill = makeSkill({ _id: "skill_1", slug: "test-skill", displayName: "Test Skill" });
    useQueryMock.mockImplementation((_query, args) => {
      if (args === "skip") return undefined;
      return [skill];
    });

    render(
      <I18nProvider>
        <Stars />
      </I18nProvider>,
    );
    const unstarBtn = screen.getByLabelText("Unstar Test Skill");
    fireEvent.click(unstarBtn);

    expect(toggleStarMock).toHaveBeenCalledWith({ skillId: "skill_1" });
  });
});
