"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { authClient, useGoogleSignIn } from "@/lib/auth/client";
import { authErrorMessage, type AuthFailure } from "@/lib/auth/error-messages";
import { UNEXPECTED_ERROR_HE } from "@/lib/messages.he";
import { Field, PasswordInput } from "@/components/auth/AuthFields";
import { ErrorAlert } from "@/components/ErrorAlert";
import { AUTH_LINK } from "@/components/auth/styles";
import { formatCredits } from "@/lib/billing/format";
import { DIALOG_ACTION } from "../action-buttons";
import { BusyLabel } from "../Marks";
import { OptionRow } from "./Section";

const CONFIRM_PHRASE = "מחק את החשבון שלי";
const SETTINGS_PATH = "/app/settings";

type Step = "closed" | "confirm" | "reauth";

interface ReauthMethods {
  password: boolean;
  google: boolean;
}

// Every account from before password sign-in has Google.
const GOOGLE_ONLY: ReauthMethods = { password: false, google: true };

export function DeleteAccount({ subscribed, credits, topupCredits }: { subscribed: boolean; credits: number; topupCredits: number }) {
  const [step, setStep] = useState<Step>("closed");
  const [busy, setBusy] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [methods, setMethods] = useState<ReauthMethods>(GOOGLE_ONLY);
  const [error, setError] = useState<string | null>(null);
  const google = useGoogleSignIn();

  const locked = busy || google.redirecting;
  const canDelete = phrase.trim() === CONFIRM_PHRASE;

  // Without a password Better Auth deletes only from a session under a day old; a correct password stands in for it.
  async function remove(withPassword?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.deleteUser(withPassword ? { password: withPassword } : {});
      if (!res.error) {
        window.location.assign("/");
        return;
      }
      if (res.error.code === "SESSION_EXPIRED") {
        setMethods(await loadReauthMethods());
        setStep("reauth");
      } else {
        setError(deleteErrorMessage(res.error));
      }
    } catch {
      setError(UNEXPECTED_ERROR_HE);
    }
    setBusy(false);
  }

  function handlePassword(event: FormEvent) {
    event.preventDefault();
    if (!locked && password) void remove(password);
  }

  function cancel() {
    setStep("closed");
    setPhrase("");
    setPassword("");
    setError(null);
  }

  const cancelButton = (
    <button type="button" onClick={cancel} disabled={locked} className={DIALOG_ACTION.quiet}>
      ביטול
    </button>
  );

  const confirmation =
    step === "confirm" ? (
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="text-sm text-espresso">
            לאישור, הקלידו את המשפט: <span className="inline-block break-words rounded bg-white px-2 py-0.5 font-semibold">{CONFIRM_PHRASE}</span>
          </span>
          <input
            type="text"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            disabled={locked}
            dir="rtl"
            autoComplete="off"
            className="w-full rounded-xl border border-sand bg-white px-4 py-2.5 text-espresso focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-600/30 disabled:opacity-50"
          />
        </label>
        <Actions>
          {cancelButton}
          <button type="button" onClick={() => void remove()} disabled={!canDelete || locked} aria-busy={busy} className={DIALOG_ACTION.danger}>
            <BusyLabel busy={busy} busyText="מוחקים…">מחיקת החשבון</BusyLabel>
          </button>
        </Actions>
      </div>
    ) : methods.password ? (
      <form onSubmit={handlePassword} className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed text-espresso">מטעמי אבטחה, הזינו את הסיסמה שלכם כדי לאשר את המחיקה.</p>
        <Field id="delete-password" label="סיסמה">
          <PasswordInput id="delete-password" value={password} onChange={setPassword} disabled={locked} isNew={false} />
          {methods.google ? (
            <button type="button" onClick={() => google.start(SETTINGS_PATH)} disabled={locked} className={`mt-2 text-xs ${AUTH_LINK}`}>
              להתחבר מחדש עם גוגל במקום
            </button>
          ) : null}
        </Field>
        <Actions>
          {cancelButton}
          <button type="submit" disabled={!password || locked} aria-busy={busy} className={DIALOG_ACTION.danger}>
            <BusyLabel busy={busy} busyText="מוחקים…">מחיקת החשבון</BusyLabel>
          </button>
        </Actions>
      </form>
    ) : (
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed text-espresso">
          מטעמי אבטחה צריך להתחבר מחדש לפני המחיקה. אחרי ההתחברות תחזרו לכאן ותוכלו למחוק.
        </p>
        <Actions>
          {cancelButton}
          <button type="button" onClick={() => google.start(SETTINGS_PATH)} disabled={locked} className={DIALOG_ACTION.primary}>
            התחברות מחדש עם גוגל
          </button>
        </Actions>
      </div>
    );

  return (
    <div className="mt-4">
      <OptionRow
        title="מחיקת החשבון"
        detail="מוחק לצמיתות את הסוכן, הנתונים והקרדיטים"
        danger
        expanded={step !== "closed"}
        disabled={locked}
        onSelect={() => (step === "closed" ? setStep("confirm") : cancel())}
      />

      {step === "closed" ? null : (
        <div className="mt-2 flex flex-col gap-4 rounded-2xl border border-red-200 bg-red-50/60 p-4 sm:p-5">
          <ul className="flex list-disc flex-col gap-1 ps-5 text-sm leading-relaxed text-espresso">
            {subscribed ? <li>המנוי יבוטל, ולא יהיו חיובים נוספים.</li> : null}
            {credits > 0 ? (
              <li>
                {formatCredits(credits)} הקרדיטים שנשארו בחשבון יימחקו{topupCredits > 0 ? `, כולל ${formatCredits(topupCredits)} מטעינות` : ""}.
              </li>
            ) : null}
            <li>הסוכן, החיבורים לוואטסאפ ולטלגרם וכל הנתונים יימחקו.</li>
            <li className="font-semibold">אי אפשר לבטל את המחיקה.</li>
          </ul>
          {confirmation}
          <ErrorAlert>{error ?? google.error}</ErrorAlert>
        </div>
      )}
    </div>
  );
}

// RTL: the primary action sits far-left on desktop and on top on mobile, so it is passed last.
function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">{children}</div>;
}

// 409 carries our own Hebrew message (a pending checkout); everything else is a Better Auth code.
function deleteErrorMessage(error: AuthFailure): string {
  return error.status === 409 && error.message ? error.message : authErrorMessage(error);
}

async function loadReauthMethods(): Promise<ReauthMethods> {
  try {
    const { data } = await authClient.listAccounts();
    const providers = new Set((data ?? []).map((account) => account.providerId));
    const methods = { password: providers.has("credential"), google: providers.has("google") };
    return methods.password || methods.google ? methods : GOOGLE_ONLY;
  } catch {
    return GOOGLE_ONLY;
  }
}
