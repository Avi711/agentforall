"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] segment error", error);
  }, [error]);

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <section className="bg-white rounded-2xl shadow-sm border border-red-200 p-8">
        <h2 className="font-display text-2xl text-red-700 mb-2">
          משהו השתבש
        </h2>
        <p className="text-espresso-light mb-6">
          לא הצלחנו לטעון את הדף הזה. נסו שוב בעוד רגע; אם זה נמשך — ספרו לנו
          ב-support@agentforall.co.il.
        </p>
        <button
          type="button"
          onClick={reset}
          className="px-5 py-2.5 rounded-xl bg-terra text-white font-medium hover:bg-terra-light transition"
        >
          ניסיון נוסף
        </button>
        {error.digest ? (
          <p className="mt-4 text-xs text-espresso-light">
            מזהה שגיאה: <code className="font-mono">{error.digest}</code>
          </p>
        ) : null}
      </section>
    </div>
  );
}
