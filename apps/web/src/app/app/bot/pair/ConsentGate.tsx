"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WhatsappConsentBody } from "@/content/whatsapp-consent.he";
import { CURRENT_CONSENT_VERSION } from "@/lib/consent-version";
import { UNEXPECTED_ERROR_HE } from "@/lib/messages.he";

export function ConsentGate() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/bot/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ acceptedVersion: CURRENT_CONSENT_VERSION }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error?.code ?? UNEXPECTED_ERROR_HE);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : UNEXPECTED_ERROR_HE);
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-sand-light p-8 max-w-2xl">
      <h2 className="font-display text-2xl text-espresso mb-3">
        לפני שמחברים את WhatsApp — חשוב שתקראו
      </h2>
      <WhatsappConsentBody />

      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={handleAccept}
          disabled={busy}
          className="px-6 py-3 rounded-xl bg-terra text-white font-medium hover:bg-terra-light transition disabled:opacity-50"
        >
          {busy ? "מאשר…" : "אני מסכים וממשיך"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/app")}
          disabled={busy}
          className="px-6 py-3 rounded-xl text-espresso-light hover:text-espresso hover:bg-cream-dark transition"
        >
          חזרה
        </button>
      </div>

      {error ? (
        <p className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
          {error}
        </p>
      ) : null}
    </div>
  );
}
