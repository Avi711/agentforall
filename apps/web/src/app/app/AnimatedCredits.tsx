"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/components/motion";
import { formatCredits } from "@/lib/billing/format";

const RISE_MS = 900;
const GAIN_SHOWN_MS = 2600;

// Rises from the last value shown whenever the balance grows; `from` sets where the first rise starts.
export function AnimatedCredits({ value, from = value, showGain = false }: { value: number; from?: number; showGain?: boolean }) {
  const numberRef = useRef<HTMLSpanElement>(null);
  const shown = useRef(from);
  const [firstText] = useState(() => formatCredits(from));
  const [gain, setGain] = useState<number | null>(null);

  useEffect(() => {
    const el = numberRef.current;
    const start = shown.current;
    shown.current = value;
    if (!el) return;
    if (value <= start) {
      el.textContent = formatCredits(value);
      return;
    }
    const duration = prefersReducedMotion() ? 0 : RISE_MS;
    let startedAt: number | null = null;
    let frame = requestAnimationFrame(function rise(now) {
      if (startedAt === null) {
        startedAt = now;
        if (showGain) setGain(value - start);
      }
      const progress = duration === 0 ? 1 : Math.min(1, (now - startedAt) / duration);
      el.textContent = formatCredits(Math.round(start + (value - start) * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(rise);
    });
    const hideGain = setTimeout(() => setGain(null), GAIN_SHOWN_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(hideGain);
    };
  }, [value, showGain]);

  return (
    <>
      <span className="sr-only">{formatCredits(value)}</span>
      <span ref={numberRef} aria-hidden>
        {firstText}
      </span>
      {gain !== null ? (
        <span aria-hidden className="ms-2 inline-block rounded-full bg-sage-pale px-2 py-0.5 align-middle text-sm font-semibold tracking-normal text-sage-dark">
          +{formatCredits(gain)}
        </span>
      ) : null}
    </>
  );
}
