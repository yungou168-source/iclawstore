/* @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aiDirectOrganizationApi } from "../lib/aiDirectOrganizationApi";
import { aiDirectPaidHiringApi } from "../lib/aiDirectPaidHiringApi";
import { I18nProvider } from "../lib/i18n/context";
import { RecruitPaidHiringFlow } from "./RecruitPaidHiringFlow";

const candidate = (agentId: string, category: string) => ({
  agentId,
  agentVersionId: `${agentId}-version`,
  displayName: `${category} Agent`,
  summary: null,
  category,
  availability: "available",
  priceStatus: "active",
});

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("RecruitPaidHiringFlow", () => {
  it("uses the selected category when loading candidate agents", async () => {
    vi.spyOn(aiDirectOrganizationApi, "listOrganizations").mockResolvedValue({
      items: [{ id: "organization-1", name: "示例组织" }],
      nextCursor: null,
    } as never);
    vi.spyOn(aiDirectOrganizationApi, "listCompanies").mockResolvedValue({
      items: [
        {
          id: "company-1",
          organizationId: "organization-1",
          name: "示例公司",
          companyRole: "recruiter",
        },
      ],
      nextCursor: null,
    } as never);
    vi.spyOn(aiDirectOrganizationApi, "listDepartments").mockResolvedValue({
      items: [],
      nextCursor: null,
    } as never);
    vi.spyOn(aiDirectOrganizationApi, "listPositions").mockResolvedValue({
      items: [],
      nextCursor: null,
    } as never);
    vi.spyOn(aiDirectOrganizationApi, "listPositionRoles").mockResolvedValue({
      items: [],
      nextCursor: null,
    } as never);
    vi.spyOn(aiDirectPaidHiringApi, "listCandidateCategories").mockResolvedValue({
      items: [
        { categoryKey: "engineering", candidateCount: 1 },
        { categoryKey: "design", candidateCount: 1 },
      ],
    });
    const listCandidates = vi
      .spyOn(aiDirectPaidHiringApi, "listCandidateCatalog")
      .mockImplementation(async (_organizationId, input = {}) => ({
        items:
          input.category === "design"
            ? [candidate("design-1", "design")]
            : [candidate("engineering-1", "engineering")],
        nextCursor: null,
      }));

    render(
      <I18nProvider>
        <RecruitPaidHiringFlow />
      </I18nProvider>,
    );

    await screen.findByText("engineering Agent");
    fireEvent.change(screen.getByLabelText("候选分类"), { target: { value: "design" } });

    await screen.findByText("design Agent");
    expect(listCandidates).toHaveBeenLastCalledWith("organization-1", {
      category: "design",
      limit: 50,
    });
  });
});
