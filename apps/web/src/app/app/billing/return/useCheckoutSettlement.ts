"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { usePolling, type PollState } from "../../usePolling";
import { BillingClientError, fetchCheckoutSessionStatus } from "../client";

export type Settlement = PollState | "failed";

// A completed session re-renders the page on the server, which then shows the receipt.
export function useCheckoutSettlement(sessionId: string, pending: boolean): Settlement {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const polling = usePolling(async () => {
    try {
      const status = await fetchCheckoutSessionStatus(sessionId);
      if (status === "completed") router.refresh();
      if (status !== "failed") return false;
    } catch (err) {
      if (!(err instanceof BillingClientError && err.code === "not_found")) throw err;
    }
    setFailed(true);
    return true;
  }, pending && !failed ? sessionId : null);
  return failed ? "failed" : polling;
}
