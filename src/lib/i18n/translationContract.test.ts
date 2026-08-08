import { describe, expect, it } from "vitest";
import { t, translations } from "./translations";

const placeholders = (value: string) =>
  [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe("translation dictionary contract", () => {
  it("keeps the Chinese and English key sets identical", () => {
    expect(Object.keys(translations["zh-CN"]).sort()).toEqual(Object.keys(translations.en).sort());
  });

  it("keeps interpolation variables identical in both locales", () => {
    for (const key of Object.keys(translations["zh-CN"]) as Array<
      keyof (typeof translations)["zh-CN"]
    >) {
      expect(placeholders(translations["zh-CN"][key])).toEqual(placeholders(translations.en[key]));
    }
  });

  it("provides paid-hiring and management copy in both locales", () => {
    expect(t("ai_direct.pricing.title", "zh-CN")).toBe("Agent 雇佣定价");
    expect(t("ai_direct.pricing.title", "en")).toBe("Agent hiring pricing");
    expect(t("ai_direct.settlement.title", "zh-CN")).toBe("开发者结算运营");
    expect(t("ai_direct.settlement.title", "en")).toBe("Developer settlement operations");
    expect(t("ai_direct.recruitment.title", "zh-CN")).toBe("选择 Agent 并发起付费雇佣");
    expect(t("ai_direct.recruitment.title", "en")).toBe("Choose an agent and start paid hiring");
  });
});
