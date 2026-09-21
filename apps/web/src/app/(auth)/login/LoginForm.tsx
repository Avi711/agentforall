"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { authClient, useGoogleSignIn, useOnBfcacheRestore } from "@/lib/auth/client";
import { authErrorMessage, type AuthFailure } from "@/lib/auth/error-messages";
import { useTurnstile } from "@/lib/auth/turnstile";
import { MAX_NAME_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/auth/policy";
import { BusyLabel } from "@/app/app/Marks";
import { AuthAlert, CaptchaSlot, Field, PasswordInput } from "@/components/auth/AuthFields";
import { AUTH_INPUT, AUTH_LINK, AUTH_PRIMARY, AUTH_SECONDARY, NEW_PASSWORD_HINT } from "@/components/auth/styles";
import type { FormMode } from "./modes";

type SentMode = "verify-sent" | "unverified" | "reset-sent";
type Mode = FormMode | SentMode;
type AuthCall = (headers: Record<string, string>) => Promise<{ error: AuthFailure | null }>;

const RESEND_COOLDOWN_S = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SENT_TEXT: Record<SentMode, string> = {
  "verify-sent": "שלחנו מייל לכתובת הזו. פתחו אותו (אפשר גם מהטלפון) והזינו את הסיסמה שבחרתם.",
  unverified: "הכתובת עוד לא אושרה. פתחו את קישור האישור ששלחנו, או בקשו קישור חדש.",
  "reset-sent": "אם יש חשבון עם הכתובת הזו, שלחנו אליה קישור לבחירת סיסמה חדשה.",
};

const MODE_HEADING: Partial<Record<FormMode, string>> = {
  signup: "הרשמה עם מייל",
  forgot: "בחירת סיסמה חדשה",
};

const SUBMIT_LABEL: Record<FormMode, { idle: string; busy: string }> = {
  signin: { idle: "כניסה", busy: "נכנס…" },
  signup: { idle: "יצירת חשבון", busy: "יוצר חשבון…" },
  forgot: { idle: "שליחת קישור", busy: "שולח…" },
};

function isSentMode(mode: Mode): mode is SentMode {
  return mode in SENT_TEXT;
}

export function LoginForm({
  redirectTo,
  initialMode,
  initialError,
}: {
  redirectTo: string;
  initialMode: FormMode;
  initialError: string | null;
}) {
  const google = useGoogleSignIn();
  const [urlError, setUrlError] = useState(initialError);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [switched, setSwitched] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const busy = pending || google.redirecting;
  const turnstile = useTurnstile();
  useOnBfcacheRestore(() => setPending(false));
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Lands on /login once confirmed, which forwards the new session to where the user was going.
  const callbackURL = `/login?redirect=${encodeURIComponent(redirectTo)}`;
  const sent = isSentMode(mode);

  useEffect(() => {
    if (sent) headingRef.current?.focus();
  }, [sent]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  function switchMode(next: Mode) {
    setUrlError(null);
    setMode(next);
    setSwitched(true);
    setError(null);
    setNotice(null);
    setPassword("");
    if (next === "verify-sent") setCooldown(RESEND_COOLDOWN_S);
  }

  // With no onSuccess the call itself navigates away, so the button stays busy until the page unloads.
  async function run(call: AuthCall, onSuccess?: () => void) {
    if (busy) return;
    setUrlError(null);
    setPending(true);
    setError(null);
    setNotice(null);
    let navigating = false;
    try {
      const { error: failure } = await call(await turnstile.captchaHeaders());
      if (failure?.code === "EMAIL_NOT_VERIFIED") switchMode("unverified");
      else if (failure) setError(authErrorMessage(failure));
      else if (onSuccess) onSuccess();
      else navigating = true;
    } catch {
      setError(authErrorMessage(null));
    } finally {
      turnstile.reset();
      if (!navigating) setPending(false);
    }
  }

  // Hebrew messages instead of the browser's own validation bubbles, which follow the browser language.
  function validate(trimmedEmail: string): string | null {
    if (mode === "signup" && !name.trim()) return "הזינו שם פרטי.";
    if (!EMAIL_RE.test(trimmedEmail)) return authErrorMessage({ code: "INVALID_EMAIL" });
    if (mode === "forgot") return null;
    if (!password) return "הזינו סיסמה.";
    if (mode === "signup" && password.length < MIN_PASSWORD_LENGTH) return authErrorMessage({ code: "PASSWORD_TOO_SHORT" });
    return null;
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmedEmail = email.trim();
    const invalid = validate(trimmedEmail);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (mode === "signin") {
      void run((headers) => authClient.signIn.email({ email: trimmedEmail, password, callbackURL, fetchOptions: { headers } }));
    } else if (mode === "signup") {
      void run(
        (headers) =>
          authClient.signUp.email({ name: name.trim(), email: trimmedEmail, password, callbackURL, fetchOptions: { headers } }),
        () => switchMode("verify-sent"),
      );
    } else if (mode === "forgot") {
      void run(
        (headers) => authClient.requestPasswordReset({ email: trimmedEmail, redirectTo: "/reset-password", fetchOptions: { headers } }),
        () => switchMode("reset-sent"),
      );
    }
  }

  function resendVerification() {
    void run(
      (headers) => authClient.sendVerificationEmail({ email: email.trim(), callbackURL, fetchOptions: { headers } }),
      () => {
        setNotice("שלחנו שוב.");
        setCooldown(RESEND_COOLDOWN_S);
      },
    );
  }

  const captcha = <CaptchaSlot slotRef={turnstile.containerRef} />;
  const messages = (
    <>
      <AuthAlert>{error}</AuthAlert>
      {notice ? <p role="status" className="text-sm text-espresso bg-cream-dark rounded-lg p-3">{notice}</p> : null}
    </>
  );

  if (isSentMode(mode)) {
    const canResend = mode !== "reset-sent";
    return (
      <div className="space-y-4 text-center">
        <h2 ref={headingRef} tabIndex={-1} className="font-display text-xl text-espresso focus:outline-none">
          בדקו את המייל שלכם
        </h2>
        <p className="text-sm text-espresso-light leading-relaxed">
          {SENT_TEXT[mode]}
          <br />
          <span dir="ltr" className="font-medium text-espresso">{email.trim()}</span>
        </p>
        <p className="text-xs text-espresso-light">לא הגיע תוך כמה דקות? בדקו בתיקיית הספאם.</p>
        {canResend ? captcha : null}
        {messages}
        <div className="flex flex-col items-center gap-1 pt-1">
          {canResend ? (
            <button
              type="button"
              onClick={resendVerification}
              disabled={busy || cooldown > 0}
              aria-busy={pending}
              className={`w-full ${AUTH_SECONDARY}`}
            >
              <BusyLabel busy={pending} busyText="שולח…">
                {cooldown > 0 ? `שליחה חוזרת בעוד ${cooldown} שניות` : "שליחת קישור חדש"}
              </BusyLabel>
            </button>
          ) : null}
          <p className="text-sm text-espresso-light py-2">
            {canResend ? "אישרתם מהטלפון? " : null}
            <button type="button" onClick={() => switchMode("signin")} disabled={busy} className={AUTH_LINK}>
              חזרה לכניסה
            </button>
          </p>
          {mode === "verify-sent" ? (
            <button type="button" onClick={() => switchMode("signup")} disabled={busy} className={`text-sm py-2 ${AUTH_LINK}`}>
              טעיתם בכתובת? חזרה להרשמה
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const label = SUBMIT_LABEL[mode];
  const heading = MODE_HEADING[mode];

  return (
    <div className="space-y-5">
      <AuthAlert>{urlError}</AuthAlert>
      <button
        type="button"
        onClick={() => google.start(redirectTo)}
        disabled={busy}
        className="w-full flex items-center justify-center gap-3 px-5 py-3 rounded-xl border border-sand bg-white hover:bg-cream-dark transition disabled:opacity-50 text-espresso font-medium"
      >
        <GoogleMark />
        <span>המשך עם Google</span>
      </button>
      <AuthAlert>{google.error}</AuthAlert>
      <div className="flex items-center gap-3 text-xs text-espresso-light" aria-hidden="true">
        <span className="h-px flex-1 bg-sand-light" />
        או עם מייל
        <span className="h-px flex-1 bg-sand-light" />
      </div>
      <form key={mode} onSubmit={handleSubmit} noValidate className="space-y-4">
        {heading ? <h2 className="font-display text-lg text-espresso">{heading}</h2> : null}
        {mode === "forgot" ? (
          <p className="text-sm text-espresso-light leading-relaxed">
            הזינו את כתובת המייל של החשבון, ונשלח אליה קישור לבחירת סיסמה חדשה.
          </p>
        ) : null}

        {mode === "signup" ? (
          <Field id="auth-name" label="שם פרטי">
            <input
              id="auth-name"
              type="text"
              name="name"
              maxLength={MAX_NAME_LENGTH}
              autoComplete="given-name"
              autoFocus={switched}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              className={AUTH_INPUT}
            />
          </Field>
        ) : null}

        <Field id="auth-email" label="כתובת מייל">
          <input
            id="auth-email"
            type="email"
            name="email"
            dir="ltr"
            autoComplete="username"
            inputMode="email"
            autoFocus={switched && mode !== "signup"}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            className={`${AUTH_INPUT} text-left`}
          />
        </Field>

        {mode !== "forgot" ? (
          <Field id="auth-password" label="סיסמה" hint={mode === "signup" ? NEW_PASSWORD_HINT : undefined}>
            <PasswordInput id="auth-password" value={password} onChange={setPassword} disabled={busy} isNew={mode === "signup"} />
            {mode === "signin" ? (
              <button type="button" onClick={() => switchMode("forgot")} disabled={busy} className={`mt-1 py-2 text-sm ${AUTH_LINK}`}>
                שכחתי סיסמה
              </button>
            ) : null}
          </Field>
        ) : null}

        {captcha}
        {messages}

        <button type="submit" disabled={busy} aria-busy={pending} className={AUTH_PRIMARY}>
          <BusyLabel busy={pending} busyText={label.busy}>{label.idle}</BusyLabel>
        </button>

        <p className="text-center text-sm text-espresso-light">
          {mode === "signin" ? "אין לכם חשבון? " : mode === "signup" ? "כבר יש לכם חשבון? " : null}
          <button type="button" onClick={() => switchMode(mode === "signin" ? "signup" : "signin")} disabled={busy} className={AUTH_LINK}>
            {mode === "signin" ? "הרשמה עם מייל" : mode === "signup" ? "כניסה" : "חזרה לכניסה"}
          </button>
        </p>
      </form>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.97 10.97 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
        fill="#EA4335"
      />
    </svg>
  );
}
