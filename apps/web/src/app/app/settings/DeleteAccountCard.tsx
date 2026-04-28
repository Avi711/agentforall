"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth/client";
import { UNEXPECTED_ERROR_HE } from "@/lib/messages.he";

const CONFIRM_PHRASE = "מחק את החשבון שלי";

export function DeleteAccountCard() {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  const canDelete = phrase.trim() === CONFIRM_PHRASE;

  async function handleDelete() {
    if (!canDelete || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Better Auth sends a verification email; the actual deletion (and the
      // orchestrator bot cleanup in beforeDelete) runs when the user clicks
      // the link. This is a security requirement for OAuth users.
      const res = await authClient.deleteUser({
        callbackURL: "/?account_deleted=1",
      });
      if (res.error) {
        throw new Error(res.error.message ?? "שגיאה במחיקה");
      }
      setEmailSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : UNEXPECTED_ERROR_HE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white rounded-2xl border border-red-200 p-8">
      <h2 className="font-display text-xl text-red-800 mb-2">מחיקת חשבון</h2>
      <p className="text-sm text-espresso-light mb-6 leading-relaxed">
        מחיקת החשבון תסיר לצמיתות את הסוכן שלכם, את חיבור ה-WhatsApp וכל
        הנתונים השמורים בחשבון. פעולה זו אינה הפיכה.
      </p>

      {emailSent ? (
        <div className="text-sm bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-900 leading-relaxed">
          שלחנו לכם מייל עם קישור לאישור המחיקה. פתחו אותו וכתחילה הקישור
          למחיקה סופית. הקישור תקף חמש דקות.
        </div>
      ) : !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="px-4 py-2 rounded-lg border border-red-300 text-red-700 hover:bg-red-50 transition text-sm font-medium"
        >
          מחיקת חשבון
        </button>
      ) : (
        <div className="space-y-4">
          <label className="block">
            <span className="block text-sm text-espresso mb-2">
              לאישור, הקלידו את המשפט:{" "}
              <code className="bg-cream-dark px-2 py-0.5 rounded">
                {CONFIRM_PHRASE}
              </code>
            </span>
            <input
              type="text"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              disabled={busy}
              dir="rtl"
              autoComplete="off"
              className="w-full px-4 py-2.5 rounded-lg border border-sand bg-white text-espresso focus:outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100 disabled:opacity-50"
            />
          </label>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleDelete}
              disabled={!canDelete || busy}
              className="px-5 py-2.5 rounded-lg bg-red-700 text-white font-medium hover:bg-red-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? "מוחק…" : "אישור מחיקה"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setPhrase("");
                setError(null);
              }}
              disabled={busy}
              className="px-5 py-2.5 rounded-lg text-espresso-light hover:text-espresso hover:bg-cream-dark transition disabled:opacity-50"
            >
              ביטול
            </button>
          </div>

          {error ? (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
