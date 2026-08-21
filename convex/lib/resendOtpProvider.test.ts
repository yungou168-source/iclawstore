import { describe, expect, it } from "vitest";
import { DEFAULT_AUTH_EMAIL_FROM, verificationEmailContent } from "./resendOtpProvider";

describe("ResendOtp branding", () => {
  it("uses AI直聘 for the default sender, subject and message bodies", () => {
    const content = verificationEmailContent("1234");

    expect(DEFAULT_AUTH_EMAIL_FROM).toBe("AI直聘 <hi@zhipin.store>");
    expect(content.subject).toBe("AI直聘登录验证码");
    expect(content.html).toContain("登录 AI直聘");
    expect(content.html).toContain("1234");
    expect(content.text).toContain("AI直聘登录验证码是 1234");
    expect(JSON.stringify(content)).not.toContain("ClawHub");
  });
});
