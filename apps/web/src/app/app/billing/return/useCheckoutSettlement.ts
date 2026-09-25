"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BillingClientError, fetchCheckoutSessionStatus } from "../client";

const FAST_POLL_MS = 2_000;
const SLOW_POLL_MS = 10_000;
const SLOW_AFTER_MS = 60_000;
const GIVE_UP_AFTER_MS = 15 * 60_000;

export type Settlement = "waiting" | "slow" | "failed";

// A completed session re-renders the page on the server, which then shows the receipt.
export function useCheckoutSettlement(sessionId: string, pending: boolean): Settlement {
  const router = useRouter();
  const [settlement, setSettlement] = useState<Settlement>("waiting");

  useEffect(() => {
    if (!pending) return;
    const startedAt = Date.now();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const elapsed = Date.now() - startedAt;
      try {
        const status = await fetchCheckoutSessionStatus(sessionId);
        if (cancelled) return;
        if (status === "failed") return setSettlement("failed");
        if (status === "completed") router.refresh();
      } catch (err) {
        if (cancelled) return;
        if (err instanceof BillingClientError && err.code === "not_found") return setSettlement("failed");
        // Any other failure is transient: the next tick retries.
      }
      if (elapsed > SLOW_AFTER_MS) setSettlement("slow");
      if (elapsed < GIVE_UP_AFTER_MS) timer = setTimeout(tick, elapsed > SLOW_AFTER_MS ? SLOW_POLL_MS : FAST_POLL_MS);
    };
    timer = setTimeout(tick, FAST_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId, pending, router]);

  return settlement;
}
