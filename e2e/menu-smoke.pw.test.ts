import { expect, test, type Page } from "@playwright/test";
import { expectHealthyPage, trackRuntimeErrors } from "./helpers/runtimeErrors";

async function workspaceLink(page: Page, name: string) {
  const link = page.getByRole("link", { name }).first();
  await expect(link).toBeVisible();
  return link;
}

test("AI employee directory loads without error", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/recruit-ai", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "招聘你的 AI 员工" })).toBeVisible();
  await expect(page.getByPlaceholder("搜索岗位、领域或技能")).toBeVisible();
  await expectHealthyPage(page, errors);
});

test("AI employee directory filters roles without error", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/recruit-ai", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("搜索岗位、领域或技能").fill("地理学家");
  await expect(page.getByRole("heading", { name: "地理学家" })).toBeVisible();
  await expect(page.getByText("1 个岗位", { exact: true })).toBeVisible();
  await expectHealthyPage(page, errors);
});

test("workspace header routes render", async ({ page }) => {
  const errors = trackRuntimeErrors(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await (await workspaceLink(page, "招聘 AI 员工")).click();
  await expect(page).toHaveURL(/\/recruit-ai$/);
  await expect(page.getByRole("heading", { name: "招聘你的 AI 员工" })).toBeVisible();

  await (await workspaceLink(page, "客户端下载")).click();
  await expect(page).toHaveURL(/\/desktop-client$/);
  await expect(page.getByRole("heading", { name: "招Ai员工,用AI直聘" })).toBeVisible();
  await expectHealthyPage(page, errors);
});

test("desktop client header controls remain interactive", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/desktop-client", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "切换语言" }).click();
  await page.getByRole("menuitem", { name: /English/ }).click();
  await expect(
    page.getByRole("heading", { name: "Assign work to AI employees with AI Direct Hiring" }),
  ).toBeVisible();

  const signIn = page.getByRole("button", { name: "Sign In", exact: true });
  await expect(signIn).toBeEnabled();
  await signIn.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectHealthyPage(page, errors);
});
