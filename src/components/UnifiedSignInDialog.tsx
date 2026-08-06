import { useAuthActions } from "@convex-dev/auth/react";
import { Mail } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
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
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const emailRequestInFlight = useRef(false);
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

  const sendVerificationCode = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || emailRequestInFlight.current) return;
    emailRequestInFlight.current = true;
    clearAuthError();
    setIsSubmitting(true);
    try {
      await signIn("resend-otp", { email: normalizedEmail });
      setEmail(normalizedEmail);
      setCode("");
      setCodeSentTo(normalizedEmail);
    } catch (error) {
      setAuthError(getUserFacingAuthError(error, fallback));
    } finally {
      emailRequestInFlight.current = false;
      setIsSubmitting(false);
    }
  };

  const verifyCode = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedCode = code.replace(/\D/g, "");
    if (normalizedCode.length !== 8 || codeSentTo !== normalizedEmail) return;
    clearAuthError();
    setIsSubmitting(true);
    try {
      const result = await signIn("resend-otp", {
        email: codeSentTo,
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

  const submitEmailSignIn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.value === "send-code") {
      void sendVerificationCode();
      return;
    }
    void verifyCode();
  };

  const normalizedEmail = email.trim().toLowerCase();
  const canVerifyCode = code.length === 8 && codeSentTo === normalizedEmail;

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
          <form className="grid gap-2" onSubmit={submitEmailSignIn}>
            <Input
              type="email"
              autoComplete="email"
              required
              maxLength={38}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setCode("");
                setCodeSentTo(null);
              }}
              placeholder="name@example.com"
              aria-label={locale === "zh-CN" ? "邮箱地址" : "Email address"}
            />
            <Input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              minLength={8}
              maxLength={8}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
              placeholder="00000000"
              aria-label={locale === "zh-CN" ? "8 位验证码" : "8-digit verification code"}
            />
            {codeSentTo ? (
              <p className="text-sm text-[color:var(--ink-soft)]">
                {locale === "zh-CN" ? `验证码已发送至 ${codeSentTo}` : `We sent a code to ${codeSentTo}`}
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="submit"
                name="intent"
                value="send-code"
                variant="outline"
                disabled={isSubmitting || !email.trim() || codeSentTo === normalizedEmail}
              >
                <Mail className="h-4 w-4" />
                {codeSentTo === normalizedEmail
                  ? locale === "zh-CN"
                    ? "验证码已发送"
                    : "Code sent"
                  : locale === "zh-CN"
                    ? "获取验证码"
                    : "Send code"}
              </Button>
              <Button
                type="submit"
                name="intent"
                value="verify-code"
                disabled={isSubmitting || !canVerifyCode}
              >
                {locale === "zh-CN" ? "验证并登录" : "Verify and sign in"}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
