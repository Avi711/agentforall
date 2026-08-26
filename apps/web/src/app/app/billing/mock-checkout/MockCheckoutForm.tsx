"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatAgorot } from "@/lib/billing/format";
import type { MockCheckoutOutcome } from "@/lib/billing/schemas";
import { UNEXPECTED_ERROR_HE } from "@/lib/messages.he";
import { completeMockCheckout } from "../client";

export function MockCheckoutForm({ sessionId, title, amountAgorot }: { sessionId: string; title: string; amountAgorot: number }) {
  const router = useRouter();
  const [pending, setPending] = useState<MockCheckoutOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function settle(outcome: MockCheckoutOutcome) {
    if (pending) return;
    setPending(outcome);
    setError(null);
    try {
      router.replace(await completeMockCheckout(sessionId, outcome));
    } catch (err) {
      setError(err instanceof Error ? err.message : UNEXPECTED_ERROR_HE);
      setPending(null);
    }
  }

  return (
    <section className="bg-white rounded-[24px] border border-sand-light p-6 sm:p-8 space-y-6">
      <div>
        <p className="text-[11px] uppercase tracking-[0.22em] text-espresso-light/70 mb-2">סליקה מדומה · פיתוח בלבד</p>
        <h1 className="font-display text-2xl text-espresso leading-tight">{title}</h1>
        <p className="text-espresso-light text-sm mt-1">{formatAgorot(amountAgorot)}</p>
      </div>
      <p className="text-sm text-espresso-light leading-relaxed">
        זהו דף תשלום מדומה. בחרו תוצאה כדי להדמות את הקריאה החוזרת מספק הסליקה.
      </p>
      <div className="flex flex-col gap-3">
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => settle("success")}
          className="px-5 py-3 rounded-lg bg-terra text-white font-medium hover:bg-terra-dark transition disabled:opacity-40"
        >
          {pending === "success" ? "מעבד…" : "תשלום מוצלח"}
        </button>
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => settle("failure")}
          className="px-5 py-3 rounded-lg border border-sand text-espresso hover:bg-cream-dark transition disabled:opacity-40"
        >
          {pending === "failure" ? "מעבד…" : "תשלום נכשל"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
          {error}
        </p>
      ) : null}
    </section>
  );
}
