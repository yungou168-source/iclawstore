import { describe, expect, it } from "vitest";
import { t } from "./translations";

describe("skill publish translations", () => {
  it("provides Chinese fixed UI copy for the publish workflow", () => {
    expect(t("publish.title", "zh-CN", { content: "技能" })).toBe("发布技能");
    expect(t("publish.drop_folder", "zh-CN")).toBe("拖放技能文件夹");
    expect(t("publish.accept_license", "zh-CN", { license: "MIT-0" })).toContain("MIT-0");
  });

  it("keeps the English publish workflow copy available", () => {
    expect(t("publish.title", "en", { content: "skill" })).toBe("Publish skill");
    expect(t("publish.submit", "en", { content: "skill" })).toBe("Publish skill");
  });

  it("provides organization administration copy in both supported locales", () => {
    expect(t("ai_direct.organizations.title", "zh-CN")).toBe("组织与公司管理");
    expect(t("ai_direct.organizations.create_company", "zh-CN")).toBe("创建公司");
    expect(t("ai_direct.organizations.title", "en")).toBe("Organization and company management");
    expect(t("ai_direct.organizations.create_company", "en")).toBe("Create company");
  });
});
