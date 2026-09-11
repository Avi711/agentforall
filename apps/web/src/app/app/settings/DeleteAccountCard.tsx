"use client";

import { useState } from "react";
import { authClient, useGoogleSignIn } from "@/lib/auth/client";
import { UNEXPECTED_ERROR_HE } from "@/lib/messages.he";

const CONFIRM_PHRASE = "מחק את החשבון שלי";
const SETTINGS_PATH = "/app/settings";

type Status = "idle" | "deleting" | "reauth";

export function DeleteAccountCard() {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const google = useGoogleSignIn();

  const deleting = status === "deleting";
  const canDelete = phrase.trim() === CONFIRM_PHRASE;
  const shownError = error ?? google.error;

  async function handleDelete() {
    if (!canDelete || deleting) return;
    setStatus("deleting");
    setError(null);
    try {
      const res = await authClient.deleteUser();
      if (res.error?.code === "SESSION_EXPIRED") {
        setStatus("reauth");
        return;
      }
      if (res.error) throw new Error(res.error.message ?? UNEXPECTED_ERROR_HE);
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : UNEXPECTED_ERROR_HE);
      setStatus("idle");
    }
  }

  function cancel() {
    setOpen(false);
    setPhrase("");
    setError(null);
    setStatus("idle");
  }

  return (
    <section className="bg-white rounded-2xl border border-red-200 p-5 sm:p-8">
      <h2 className="font-display text-xl text-red-800 mb-2">מחיקת חשבון</h2>
      <p className="text-sm text-espresso-light mb-6 leading-relaxed">
        מחיקת החשבון תסיר לצמיתות את הסוכן שלכם, את חיבור ה-WhatsApp וכל
        הנתונים השמורים בחשבון. פעולה זו אינה הפיכה.
      </p>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="px-4 py-3 rounded-lg border border-red-300 text-red-700 hover:bg-red-50 transition text-sm font-medium"
        >
          מחיקת חשבון
        </button>
      ) : status === "reauth" ? (
        <div className="space-y-4">
          <p className="text-sm bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-900 leading-relaxed">
            מטעמי אבטחה צריך להתחבר מחדש לפני המחיקה. אחרי ההתחברות תחזרו לכאן ותוכלו למחוק.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => google.start(SETTINGS_PATH)}
              disabled={google.redirecting}
              className="px-5 py-3 rounded-lg bg-espresso text-cream font-medium hover:bg-espresso-light transition disabled:opacity-50"
            >
              התחברות מחדש עם Google
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={google.redirecting}
              className="px-5 py-3 rounded-lg text-espresso-light hover:text-espresso hover:bg-cream-dark transition disabled:opacity-50"
            >
              ביטול
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <label className="block">
            <span className="block text-sm text-espresso mb-2">
              לאישור, הקלידו את המשפט:{" "}
              <code className="inline-block bg-cream-dark px-2 py-0.5 rounded break-words">
                {CONFIRM_PHRASE}
              </code>
            </span>
            <input
              type="text"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              disabled={deleting}
              dir="rtl"
              autoComplete="off"
              className="w-full px-4 py-2.5 rounded-lg border border-sand bg-white text-espresso focus:outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100 disabled:opacity-50"
            />
          </label>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={handleDelete}
              disabled={!canDelete || deleting}
              className="px-5 py-3 rounded-lg bg-red-700 text-white font-medium hover:bg-red-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {deleting ? "מוחק…" : "אישור מחיקה"}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={deleting}
              className="px-5 py-3 rounded-lg text-espresso-light hover:text-espresso hover:bg-cream-dark transition disabled:opacity-50"
            >
              ביטול
            </button>
          </div>
        </div>
      )}

      {shownError ? (
        <p className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
          {shownError}
        </p>
      ) : null}
    </section>
  );
}
