import { expect, test } from "@playwright/test";
import { expectHealthyPage, trackRuntimeErrors } from "./helpers/runtimeErrors";

test("desktop client page exposes the AI employee directory", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/desktop-client", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "把 AI 员工带到你的工作台" })).toBeVisible();
  await page.getByRole("link", { name: "浏览 AI 员工" }).click();
  await expect(page).toHaveURL(/\/recruit-ai$/);
  await expect(page.getByRole("heading", { name: "招聘你的 AI 员工" })).toBeVisible();
  await expectHealthyPage(page, errors);
});

test("AI employee selection exposes the desktop continuation", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/recruit-ai", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "选择员工" }).first().click();
  await expect(page.getByText("在客户端继续招聘", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "在客户端继续招聘" })).toHaveAttribute(
    "href",
    /\/releases$/,
  );
  await expectHealthyPage(page, errors);
});
