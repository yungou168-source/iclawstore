import { useAuthActions } from "@convex-dev/auth/react";
import { useRef, useState, type FormEvent } from "react";
import {
  getUserFacingAuthError,
  isBannedAccountAuthError,
  routeToBannedAccountPage,
} from "../lib/authErrorMessage";
import { getTranslations, type TranslationKey } from "../lib/i18n/translations";
import { clearAuthError, setAuthError } from "../lib/useAuthError";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Input } from "./ui/input";

type Props = {
  locale: "zh-CN" | "en";
  disabled?: boolean;
  redirectTo?: string;
};

const OTP_LENGTH = 4;

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-current">
      <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.11.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.28-1.69-1.28-1.69-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.57-.29-5.28-1.29-5.28-5.72 0-1.26.45-2.3 1.19-3.11-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.16 1.19a10.92 10.92 0 0 1 5.75 0C17.04 4.97 18 5.28 18 5.28c.63 1.59.23 2.77.11 3.06.74.81 1.19 1.85 1.19 3.11 0 4.44-2.71 5.42-5.29 5.71.42.36.79 1.06.79 2.14v3.25c0 .31.21.68.8.56A11.5 11.5 0 0 0 12 .7Z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.91h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.4Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.98-.9 6.63-2.43l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.39 13.86A6.01 6.01 0 0 1 6.08 12c0-.65.11-1.28.31-1.86V7.52H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.48l3.35-2.62Z"
      />
      <path
        fill="#EA4335"
        d="M12 6.01c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.63 9.63 0 0 0 12 2a10 10 0 0 0-8.96 5.52l3.35 2.62C7.18 7.77 9.39 6.01 12 6.01Z"
      />
    </svg>
  );
}

export function UnifiedSignInDialog({ locale, disabled, redirectTo }: Props) {
  const { signIn } = useAuthActions();
  const t = (key: TranslationKey, vars?: Record<string, string | number>) => {
    const template = getTranslations(locale)[key];
    return vars
      ? template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`))
      : template;
  };
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const emailRequestInFlight = useRef(false);
  const fallback = t("auth.sign_in_failed");

  const startSignIn = async (provider: "github" | "google", label: string) => {
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
    if (normalizedCode.length !== OTP_LENGTH || codeSentTo !== normalizedEmail) return;
    clearAuthError();
    setIsSubmitting(true);
    try {
      const result = await signIn("resend-otp", {
        email: codeSentTo,
        code: normalizedCode,
        ...(redirectTo ? { redirectTo } : {}),
      });
      if (result?.signingIn === false) {
        setAuthError(t("auth.invalid_or_expired_code"));
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
  const canVerifyCode = code.length === OTP_LENGTH && codeSentTo === normalizedEmail;

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
          {t("common.sign_in")}
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("auth.sign_in_title")}</DialogTitle>
        </DialogHeader>
        <form className="grid gap-3 pt-2" onSubmit={submitEmailSignIn}>
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
            aria-label={t("auth.email_address")}
          />
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <div className="relative min-w-0">
              <Input
                className="pr-20"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                minLength={OTP_LENGTH}
                maxLength={OTP_LENGTH}
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH))
                }
                placeholder="0000"
                aria-label={t("auth.verification_code")}
              />
              <Button
                className="absolute right-1.5 top-1/2 min-h-8 -translate-y-1/2 px-3"
                type="submit"
                name="intent"
                value="send-code"
                size="sm"
                variant="ghost"
                disabled={isSubmitting || !email.trim() || codeSentTo === normalizedEmail}
              >
                {codeSentTo === normalizedEmail ? t("auth.code_sent") : t("auth.send_code")}
              </Button>
            </div>
            <Button
              className="min-w-20"
              type="submit"
              name="intent"
              value="verify-code"
              disabled={isSubmitting || !canVerifyCode}
            >
              {t("auth.verify_and_sign_in")}
            </Button>
          </div>
          {codeSentTo ? (
            <p className="text-sm text-[color:var(--ink-soft)]">
              {t("auth.code_sent_to", { email: codeSentTo })}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => void startSignIn("github", "GitHub")}
            >
              <GitHubIcon />
              GitHub
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => void startSignIn("google", "Google")}
            >
              <GoogleIcon />
              Google
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
