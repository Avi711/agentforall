"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { BillingStatus } from "@/lib/billing/service";
import { SETTINGS_PATH } from "@/lib/billing/urls";
import { BillingClientError, fetchBillingStatus, fetchCheckoutSessionStatus } from "../billing/client";

const VERIFY_POLL_MS = 2_000;
const VERIFY_TIMEOUT_MS = 90_000;

export type VerificationOutcome = "completed" | "failed" | "timed_out";

export interface CheckoutVerification {
  verifying: boolean;
  outcome: VerificationOutcome | null;
}

export function useCheckoutVerification(sessionId: string | null, onStatus: (status: BillingStatus) => void): CheckoutVerification {
  const router = useRouter();
  const [verifying, setVerifying] = useState(sessionId !== null);
  const [outcome, setOutcome] = useState<VerificationOutcome | null>(null);

  useEffect(() => {
    if (!verifying || sessionId === null) return;
    const startedAt = Date.now();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = async (result: VerificationOutcome) => {
      if (result === "completed") onStatus(await fetchBillingStatus());
      if (cancelled) return;
      setOutcome(result);
      setVerifying(false);
      if (result === "completed") router.refresh();
    };
    const tick = async () => {
      try {
        const status = await fetchCheckoutSessionStatus(sessionId);
        if (cancelled) return;
        if (status !== "pending") return finish(status);
      } catch (err) {
        if (err instanceof BillingClientError && err.code === "not_found") return finish("failed");
        // Any other failure is transient: the next tick retries and the timeout below ends it.
      }
      if (Date.now() - startedAt > VERIFY_TIMEOUT_MS) return finish("timed_out");
      timer = setTimeout(tick, VERIFY_POLL_MS);
    };
    timer = setTimeout(tick, VERIFY_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [verifying, sessionId, onStatus, router]);

  return { verifying, outcome };
}

// A reload or back-navigation must not replay the checkout return.
export function useForgetCheckoutReturn(returned: boolean) {
  useEffect(() => {
    if (returned) window.history.replaceState(window.history.state, "", SETTINGS_PATH);
  }, [returned]);
}
