"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth/client";
import { authErrorMessage } from "@/lib/auth/error-messages";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/policy";
import { BusyLabel } from "@/app/app/Marks";
import { Field, PasswordInput } from "@/components/auth/AuthFields";
import { ErrorAlert } from "@/components/ErrorAlert";
import { AUTH_LINK, AUTH_PRIMARY, NEW_PASSWORD_HINT } from "@/components/auth/styles";

export function ResetPasswordForm({ token, linkError }: { token: string | null; linkError: string | null }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [expired, setExpired] = useState(false);

  if (!token) {
    return (
      <div className="space-y-4 text-center">
        <ErrorAlert>{linkError}</ErrorAlert>
        <Link href="/login?mode=forgot" className={`inline-block py-2 text-sm ${AUTH_LINK}`}>לבקשת קישור חדש</Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-4 text-center">
        <p role="status" className="text-espresso">הסיסמה עודכנה. מטעמי אבטחה נותקתם מכל המכשירים.</p>
        <Link href="/login" className={`inline-block ${AUTH_PRIMARY}`}>
          כניסה עם הסיסמה החדשה
        </Link>
      </div>
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || !token) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(authErrorMessage({ code: "PASSWORD_TOO_SHORT" }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: failure } = await authClient.resetPassword({ newPassword: password, token });
      if (failure) setError(authErrorMessage(failure));
      else setDone(true);
      if (failure?.code === "INVALID_TOKEN") setExpired(true);
    } catch {
      setError(authErrorMessage(null));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <Field id="new-password" label="סיסמה חדשה" hint={NEW_PASSWORD_HINT}>
        <PasswordInput id="new-password" value={password} onChange={setPassword} disabled={busy} isNew />
      </Field>

      <ErrorAlert>
        {error}
        {expired ? (
          <>
            {" "}
            <Link href="/login?mode=forgot" className="underline underline-offset-4 font-medium">לבקשת קישור חדש</Link>
          </>
        ) : null}
      </ErrorAlert>

      <button
        type="submit"
        disabled={busy}
        aria-busy={busy}
        className={AUTH_PRIMARY}
      >
        <BusyLabel busy={busy} busyText="שומר…">שמירת הסיסמה</BusyLabel>
      </button>
    </form>
  );
}
