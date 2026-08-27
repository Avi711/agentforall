"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isActive, pollPlan } from "@/lib/integrations/connections";
import { IntegrationsResponseSchema, type IntegrationConnection } from "@/lib/orchestrator/types";

const POLL_TIMEOUT_MS = 90_000;

export type WatchOutcome = "active" | "timeout";

// Keeps the list truthful: refreshes when the tab comes back and polls (bounded) while a consent flow is open.
export function useLiveConnections(
  botId: string,
  initial: IntegrationConnection[],
  watchApp: string | null,
  onWatch: (outcome: WatchOutcome) => void,
) {
  const [connections, setConnections] = useState(initial);
  // Latched: cleared once an outcome is reported, so a later disconnect cannot re-arm the watch.
  const [watch, setWatch] = useState(watchApp);
  const onWatchRef = useRef(onWatch);
  useEffect(() => {
    onWatchRef.current = onWatch;
  }, [onWatch]);

  // Only the newest response may land: a slow focus refresh must not overwrite a fresher poll result.
  const seqRef = useRef(0);
  const refresh = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      const seq = ++seqRef.current;
      try {
        const res = await fetch(`/api/bot/${botId}/integrations`, { cache: "no-store", signal });
        if (!res.ok) return;
        const parsed = IntegrationsResponseSchema.safeParse(await res.json());
        if (parsed.success && seq === seqRef.current) setConnections(parsed.data.data);
      } catch {
        // Aborted or transient; the next focus or tick tries again.
      }
    },
    [botId],
  );

  // The outcome derives from state, so a focus refresh counts as much as a poll tick.
  useEffect(() => {
    if (watch && isActive(connections, watch)) {
      setWatch(null);
      onWatchRef.current("active");
    }
  }, [connections, watch]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const plan = pollPlan(connections, watch);
  const target = plan?.target ?? null;
  const intervalMs = plan?.intervalMs ?? 0;
  useEffect(() => {
    if (intervalMs === 0) return;
    const controller = new AbortController();
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      await refresh(controller.signal);
      if (controller.signal.aborted) return;
      if (Date.now() >= deadline) {
        if (target) {
          setWatch(null);
          onWatchRef.current("timeout");
        }
        return;
      }
      timer = setTimeout(tick, intervalMs);
    };
    timer = setTimeout(tick, intervalMs);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [target, intervalMs, refresh]);

  return { connections, setConnections };
}
