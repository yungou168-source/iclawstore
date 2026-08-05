import { useAuthActions } from "@convex-dev/auth/react";
import { Mail } from "lucide-react";
import { useState, type FormEvent } from "react";
import {
  getUserFacingAuthError,
  isBannedAccountAuthError,
  routeToBannedAccountPage,
} from "../lib/authErrorMessage";
import { clearAuthError, setAuthError } from "../lib/useAuthError";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Input } from "./ui/input";

type Props = {
  locale: "zh-CN" | "en";
  disabled?: boolean;
  redirectTo?: string;
};

export function UnifiedSignInDialog({ locale, disabled, redirectTo }: Props) {
  const { signIn } = useAuthActions();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [emailStep, setEmailStep] = useState<"email" | "code">("email");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fallback = locale === "zh-CN" ? "登录失败，请重试。" : "Sign in failed. Please try again.";

  const startSignIn = async (provider: "github" | "google" | "wechat", label: string) => {
    clearAuthError();
    setIsSubmitting(true);
    try {
      const result = await signIn(provider, redirectTo ? { redirectTo } : undefined);
      if (result?.signingIn === false && !result.redirect) {
        setAuthError(`${label}: ${fallback}`);
      }
    } catch (error) {
      const message = getUserFacingAuthError(error, fallback);
      if (isBannedAccountAuthError(message)) routeToBannedAccountPage();
      else setAuthError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const sendVerificationCode = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;
    clearAuthError();
    setIsSubmitting(true);
    try {
      await signIn("resend-otp", { email: normalizedEmail });
      setEmail(normalizedEmail);
      setEmailStep("code");
    } catch (error) {
      setAuthError(getUserFacingAuthError(error, fallback));
    } finally {
      setIsSubmitting(false);
    }
  };

  const verifyCode = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedCode = code.replace(/\D/g, "");
    if (normalizedCode.length !== 8) return;
    clearAuthError();
    setIsSubmitting(true);
    try {
      const result = await signIn("resend-otp", {
        email,
        code: normalizedCode,
        ...(redirectTo ? { redirectTo } : {}),
      });
      if (result?.signingIn === false) {
        setAuthError(
          locale === "zh-CN" ? "验证码无效或已过期。" : "The code is invalid or expired.",
        );
      }
    } catch (error) {
      const message = getUserFacingAuthError(error, fallback);
      if (isBannedAccountAuthError(message)) routeToBannedAccountPage();
      else setAuthError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          type="button"
          className="github-sign-in-button"
          disabled={disabled}
        >
          {locale === "zh-CN" ? "登录" : "Sign in"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{locale === "zh-CN" ? "登录 AI直聘" : "Sign in to Ai Work"}</DialogTitle>
          <DialogDescription>
            {locale === "zh-CN"
              ? "使用邮箱验证码，或通过 GitHub、Google、微信登录。"
              : "Use an email verification code, or continue with GitHub, Google, or WeChat."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 pt-2">
          <div className="grid grid-cols-3 gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => void startSignIn("github", "GitHub")}
            >
              GitHub
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => void startSignIn("google", "Google")}
            >
              Google
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => void startSignIn("wechat", locale === "zh-CN" ? "微信" : "WeChat")}
            >
              {locale === "zh-CN" ? "微信" : "WeChat"}
            </Button>
          </div>
          <div className="flex items-center gap-3 py-1 text-xs text-[color:var(--ink-soft)]">
            <span className="h-px flex-1 bg-[color:var(--line)]" />
            {locale === "zh-CN" ? "邮箱验证码" : "email verification code"}
            <span className="h-px flex-1 bg-[color:var(--line)]" />
          </div>
          {emailStep === "email" ? (
            <form className="grid gap-2" onSubmit={sendVerificationCode}>
              <Input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                aria-label={locale === "zh-CN" ? "邮箱地址" : "Email address"}
              />
              <Button type="submit" disabled={isSubmitting || !email.trim()}>
                <Mail className="h-4 w-4" />
                {locale === "zh-CN" ? "获取验证码" : "Send verification code"}
              </Button>
            </form>
          ) : (
            <form className="grid gap-2" onSubmit={verifyCode}>
              <p className="text-sm text-[color:var(--ink-soft)]">
                {locale === "zh-CN" ? `验证码已发送至 ${email}` : `We sent a code to ${email}`}
              </p>
              <Input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                minLength={8}
                maxLength={8}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
                placeholder="00000000"
                aria-label={locale === "zh-CN" ? "8 位验证码" : "8-digit verification code"}
              />
              <Button type="submit" disabled={isSubmitting || code.length !== 8}>
                {locale === "zh-CN" ? "验证并登录" : "Verify and sign in"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={isSubmitting}
                onClick={() => {
                  setCode("");
                  setEmailStep("email");
                }}
              >
                {locale === "zh-CN" ? "更换邮箱" : "Use another email"}
              </Button>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
