"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UNEXPECTED_ERROR_HE } from "@/lib/messages.he";

export function CreateBotForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/bot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: displayName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        const code = data?.error?.code as string | undefined;
        throw new Error(codeToHe(code) ?? "לא הצלחנו ליצור את הבוט");
      }
      // Land on /app so the user can see the bot card and choose whether to
      // pair WhatsApp now or explore the dashboard first. Pairing is a
      // follow-up step, not a gate.
      router.refresh();
      router.push("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : UNEXPECTED_ERROR_HE);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="block">
        <span className="block text-sm text-espresso-light mb-1.5">
          איך הסוכן שלכם ייקרא?
        </span>
        <input
          type="text"
          required
          maxLength={60}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="לדוגמה: ג׳ארוויס, שלומי, אלפרד"
          disabled={busy}
          className="w-full px-4 py-3 rounded-xl border border-sand bg-white text-espresso placeholder:text-sand focus:outline-none focus:border-terra focus:ring-2 focus:ring-terra-pale disabled:opacity-50"
        />
      </label>
      <button
        type="submit"
        disabled={busy || displayName.trim().length === 0}
        className="px-6 py-3 rounded-xl bg-terra text-white font-medium hover:bg-terra-light transition disabled:opacity-50"
      >
        {busy ? "יוצר…" : "יצירת סוכן"}
      </button>
      {error ? (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function codeToHe(code: string | undefined): string | undefined {
  switch (code) {
    case "orchestrator_unavailable":
      return "השרת לא זמין כרגע. נסו בעוד רגע.";
    case "invalid_body":
      return "פרטים לא תקינים";
    default:
      return undefined;
  }
}
