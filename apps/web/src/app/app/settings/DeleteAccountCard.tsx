"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { authClient, useGoogleSignIn } from "@/lib/auth/client";
import { authErrorMessage, type AuthFailure } from "@/lib/auth/error-messages";
import { UNEXPECTED_ERROR_HE } from "@/lib/messages.he";
import { Field, PasswordInput } from "@/components/auth/AuthFields";
import { ErrorAlert } from "@/components/ErrorAlert";
import { AUTH_LINK } from "@/components/auth/styles";
import { BusyLabel } from "../Marks";

const CONFIRM_PHRASE = "מחק את החשבון שלי";
const SETTINGS_PATH = "/app/settings";
const DANGER_BUTTON =
  "px-5 py-3 rounded-lg bg-red-700 text-white font-medium hover:bg-red-800 transition disabled:opacity-40 disabled:cursor-not-allowed";
const PRIMARY_BUTTON =
  "px-5 py-3 rounded-lg bg-espresso text-cream font-medium hover:bg-espresso-light transition disabled:opacity-50";
const CANCEL_BUTTON =
  "px-5 py-3 rounded-lg text-espresso-light hover:text-espresso hover:bg-cream-dark transition disabled:opacity-50";

type Step = "closed" | "confirm" | "reauth";

interface ReauthMethods {
  password: boolean;
  google: boolean;
}

// Every account from before password sign-in has Google.
const GOOGLE_ONLY: ReauthMethods = { password: false, google: true };

export function DeleteAccountCard() {
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
    <button type="button" onClick={cancel} disabled={locked} className={CANCEL_BUTTON}>
      ביטול
    </button>
  );

  return (
    <section className="bg-white rounded-2xl border border-red-200 p-5 sm:p-8">
      <h2 className="font-display text-xl text-red-800 mb-2">מחיקת חשבון</h2>
      <p className="text-sm text-espresso-light mb-6 leading-relaxed">
        מחיקת החשבון תסיר לצמיתות את הסוכן שלכם, את חיבור ה-WhatsApp וכל
        הנתונים השמורים בחשבון. פעולה זו אינה הפיכה.
      </p>

      {step === "closed" ? (
        <button
          type="button"
          onClick={() => setStep("confirm")}
          className="px-4 py-3 rounded-lg border border-red-300 text-red-700 hover:bg-red-50 transition text-sm font-medium"
        >
          מחיקת חשבון
        </button>
      ) : step === "confirm" ? (
        <div className="space-y-4">
          <label className="block">
            <span className="block text-sm text-espresso mb-2">
              לאישור, הקלידו את המשפט:{" "}
              <code className="inline-block bg-cream-dark px-2 py-0.5 rounded break-words">{CONFIRM_PHRASE}</code>
            </span>
            <input
              type="text"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              disabled={locked}
              dir="rtl"
              autoComplete="off"
              className="w-full px-4 py-2.5 rounded-lg border border-sand bg-white text-espresso focus:outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100 disabled:opacity-50"
            />
          </label>
          <Actions>
            {cancelButton}
            <button type="button" onClick={() => void remove()} disabled={!canDelete || locked} aria-busy={busy} className={DANGER_BUTTON}>
              <BusyLabel busy={busy} busyText="מוחק…">אישור מחיקה</BusyLabel>
            </button>
          </Actions>
        </div>
      ) : methods.password ? (
        <form onSubmit={handlePassword} className="space-y-4">
          <p className="text-sm bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-900 leading-relaxed">
            מטעמי אבטחה, הזינו את הסיסמה שלכם כדי לאשר את המחיקה.
          </p>
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
            <button type="submit" disabled={!password || locked} aria-busy={busy} className={DANGER_BUTTON}>
              <BusyLabel busy={busy} busyText="מוחק…">אישור מחיקה</BusyLabel>
            </button>
          </Actions>
        </form>
      ) : (
        <div className="space-y-4">
          <p className="text-sm bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-900 leading-relaxed">
            מטעמי אבטחה צריך להתחבר מחדש לפני המחיקה. אחרי ההתחברות תחזרו לכאן ותוכלו למחוק.
          </p>
          <Actions>
            {cancelButton}
            <button type="button" onClick={() => google.start(SETTINGS_PATH)} disabled={locked} className={PRIMARY_BUTTON}>
              התחברות מחדש עם Google
            </button>
          </Actions>
        </div>
      )}

      {error || google.error ? (
        <div className="mt-4">
          <ErrorAlert>{error ?? google.error}</ErrorAlert>
        </div>
      ) : null}
    </section>
  );
}

// RTL: the primary action sits far-left on desktop and on top on mobile, so it is passed last.
function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-col-reverse sm:flex-row gap-3">{children}</div>;
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
