import { Email } from "@convex-dev/auth/providers/Email";

const OTP_LENGTH = 4;
const OTP_MAX_AGE_SECONDS = 2 * 60;
export const DEFAULT_AUTH_EMAIL_FROM = "AI直聘 <no-reply@iclawstore.com>";

export function verificationEmailContent(code: string) {
  return {
    subject: "AI直聘登录验证码",
    html: `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#171717">
      <h2 style="margin:0 0 16px">登录 AI直聘</h2>
      <p>你的登录验证码是：</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:20px 0">${code}</p>
      <p style="color:#666">验证码 2 分钟内有效。若非本人操作，请忽略此邮件。</p>
    </div>
  `,
    text: `你的 AI直聘登录验证码是 ${code}，2 分钟内有效。`,
  };
}

function generateOtp() {
  const bytes = new Uint8Array(OTP_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => String(byte % 10)).join("");
}

export const ResendOtp = Email({
  id: "resend-otp",
  name: "Email verification code",
  apiKey: process.env.AUTH_RESEND_KEY,
  from: process.env.AUTH_EMAIL_FROM ?? DEFAULT_AUTH_EMAIL_FROM,
  maxAge: OTP_MAX_AGE_SECONDS,
  async generateVerificationToken() {
    return generateOtp();
  },
  async sendVerificationRequest({ identifier: email, provider, token }) {
    const content = verificationEmailContent(token);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: provider.from,
        to: [email],
        subject: content.subject,
        html: content.html,
        text: content.text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to send verification code (HTTP ${response.status})`);
    }
  },
});
