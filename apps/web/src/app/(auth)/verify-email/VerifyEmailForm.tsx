"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { authClient, useOnBfcacheRestore } from "@/lib/auth/client";
import { authErrorMessage } from "@/lib/auth/error-messages";
import { useTurnstile } from "@/lib/auth/turnstile";
import { BusyLabel } from "@/app/app/Marks";
import { CaptchaSlot, Field, PasswordInput } from "@/components/auth/AuthFields";
import { ErrorAlert } from "@/components/ErrorAlert";
import { AUTH_LINK, AUTH_PRIMARY } from "@/components/auth/styles";
import { CONFIRM_INTENT_COOKIE } from "@/lib/auth/policy";


// Confirming signs in, so the password comes first: a link alone never activates a password its clicker did not set.
export function VerifyEmailForm({ token, email, callbackURL }: { token: string; email: string; callbackURL: string }) {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wrongPassword, setWrongPassword] = useState(false);
  const confirmForm = useRef<HTMLFormElement>(null);
  const turnstile = useTurnstile();
  useOnBfcacheRestore(() => setPending(false));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending || !password) return;
    setPending(true);
    setError(null);
    setWrongPassword(false);
    try {
      const { error: failure } = await authClient.signIn.email({
        email,
        password,
        callbackURL,
        fetchOptions: { headers: await turnstile.captchaHeaders() },
      });
      if (failure?.code === "EMAIL_NOT_VERIFIED") {
        document.cookie = `${CONFIRM_INTENT_COOKIE}=1; Path=/; Max-Age=60; SameSite=Strict${location.protocol === "https:" ? "; Secure" : ""}`;
        confirmForm.current?.submit();
        return;
      }
      // No failure means it was already confirmed, and the sign-in itself navigates away.
      if (!failure) return;
      if (failure.code === "INVALID_EMAIL_OR_PASSWORD") setWrongPassword(true);
      else setError(authErrorMessage(failure));
    } catch {
      setError(authErrorMessage(null));
    }
    turnstile.reset();
    setPending(false);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-espresso-light leading-relaxed">
          כדי לאשר את הכתובת, הזינו את הסיסמה שבחרתם בהרשמה.
          <br />
          <span dir="ltr" className="font-medium text-espresso">{email}</span>
        </p>
        <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
        <Field id="verify-password" label="סיסמה">
          <PasswordInput id="verify-password" value={password} onChange={setPassword} disabled={pending} isNew={false} />
        </Field>
        <CaptchaSlot slotRef={turnstile.containerRef} />
        <ErrorAlert>{error}</ErrorAlert>
        {wrongPassword ? (
          <ErrorAlert>
            הסיסמה לא תואמת. שכחתם אותה? אפשר לבחור סיסמה חדשה, וזה גם יאשר את הכתובת.{" "}
            <Link href="/login?mode=forgot" className="underline underline-offset-4 font-medium">בחירת סיסמה חדשה</Link>
          </ErrorAlert>
        ) : null}
        <button type="submit" disabled={pending || !password} aria-busy={pending} className={AUTH_PRIMARY}>
          <BusyLabel busy={pending} busyText="מאשר…">אישור והמשך</BusyLabel>
        </button>
        <p className="text-center text-sm">
          <Link href="/login" className={`inline-block py-2 ${AUTH_LINK}`}>למסך הכניסה</Link>
        </p>
      </form>
      <form ref={confirmForm} action="/api/auth/verify-email" method="get" hidden>
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="callbackURL" value={callbackURL} />
      </form>
    </div>
  );
}
