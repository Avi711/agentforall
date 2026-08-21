"use client";

import { useEffect, useRef, useState } from "react";
import type { Instance } from "@/lib/orchestrator/types";
import { toBotSnapshot, type BotSnapshot } from "@/lib/bots/snapshot";

export type { BotSnapshot, TelegramSnapshot } from "@/lib/bots/snapshot";

const TRANSITIONAL = new Set([
  "provisioning",
  "degraded",
  "unhealthy",
]);
const FAST_INTERVAL_MS = 2000;
const SLOW_INTERVAL_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;

// Unlinked telegram / awaiting pairing means the user is mid-connect in another tab.
function isTransitional(bot: BotSnapshot): boolean {
  return (
    TRANSITIONAL.has(bot.status) ||
    (bot.telegram !== null && !bot.telegram.linked) ||
    bot.pairingStatus === "awaiting_qr" ||
    bot.pairingStatus === "awaiting_code"
  );
}

export function useBotStatus(initial: BotSnapshot): BotSnapshot {
  const [bot, setBot] = useState(initial);
  const botRef = useRef(bot);
  botRef.current = bot;

  useEffect(() => {
    setBot(initial);
  }, [initial.id]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let consecutiveErrors = 0;

    const tick = async () => {
      timer = null;
      if (cancelled || inFlight) return;
      if (document.visibilityState === "hidden") {
        timer = setTimeout(tick, SLOW_INTERVAL_MS);
        return;
      }
      inFlight = true;
      try {
        const res = await fetch(`/api/bot/${botRef.current.id}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as { bot?: Instance };
        if (!cancelled && data.bot) setBot(toBotSnapshot(data.bot));
        consecutiveErrors = 0;
      } catch {
        // Best-effort poll; failures drive the consecutiveErrors backoff below.
        consecutiveErrors++;
      } finally {
        inFlight = false;
      }
      if (cancelled) return;
      const baseInterval = isTransitional(botRef.current)
        ? FAST_INTERVAL_MS
        : SLOW_INTERVAL_MS;
      const delay = Math.min(
        baseInterval * 2 ** Math.min(consecutiveErrors, 5),
        MAX_BACKOFF_MS,
      );
      timer = setTimeout(tick, delay);
    };

    const initialDelay = isTransitional(botRef.current)
      ? FAST_INTERVAL_MS
      : SLOW_INTERVAL_MS;
    timer = setTimeout(tick, initialDelay);

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !timer && !inFlight) tick();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [bot.id]);

  return bot;
}
