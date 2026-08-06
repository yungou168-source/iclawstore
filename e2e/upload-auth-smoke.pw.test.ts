import { expect, test } from "@playwright/test";
import { expectHealthyPage, trackRuntimeErrors } from "./helpers/runtimeErrors";

test("AI employee category filtering stays healthy", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/recruit-ai", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "法务" }).click();
  await expect(page.getByText(/个岗位$/, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "选择员工" }).first()).toBeVisible();
  await expectHealthyPage(page, errors);
});

test("AI employee search handles an empty result without error", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/recruit-ai", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("搜索岗位、领域或技能").fill("不存在的测试岗位");
  await expect(page.getByText("没有匹配的 AI 员工。", { exact: true })).toBeVisible();
  await expectHealthyPage(page, errors);
});
