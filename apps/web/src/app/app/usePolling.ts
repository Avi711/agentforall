"use client";

import { useEffect, useEffectEvent, useState } from "react";

const FAST_POLL_MS = 2_000;
const SLOW_POLL_MS = 10_000;
const SLOW_AFTER_MS = 60_000;
const GIVE_UP_AFTER_MS = 15 * 60_000;

export type PollState = "polling" | "slow" | "done" | "stopped";

type RunKey = string | number;

// A new `runKey` starts a fresh run; `check` resolves true once the change is visible, and a throw is retried next tick.
export function usePolling(check: () => Promise<boolean>, runKey: RunKey | null): PollState {
  const [outcome, setOutcome] = useState<{ runKey: RunKey; state: PollState } | null>(null);
  const checkLatest = useEffectEvent(check);

  useEffect(() => {
    if (runKey === null) return;
    const startedAt = Date.now();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const settle = (state: PollState) => setOutcome({ runKey, state });
    const tick = async () => {
      const done = await checkLatest().catch(() => false);
      if (cancelled) return;
      if (done) return settle("done");
      const elapsed = Date.now() - startedAt;
      if (elapsed >= GIVE_UP_AFTER_MS) return settle("stopped");
      if (elapsed > SLOW_AFTER_MS) settle("slow");
      timer = setTimeout(tick, elapsed > SLOW_AFTER_MS ? SLOW_POLL_MS : FAST_POLL_MS);
    };
    timer = setTimeout(tick, FAST_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [runKey]);

  return outcome?.runKey === runKey ? outcome.state : "polling";
}
