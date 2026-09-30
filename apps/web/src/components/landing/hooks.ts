"use client";

import { useEffect, useState, type RefObject } from "react";
import { useReducedMotion } from "@/components/motion";

export const FRAME_MS = 33;

export function usePlayOnce(ref: RefObject<HTMLElement | null>, durationMs: number, threshold = 0.4): number {
  const reduced = useReducedMotion();
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        let startedAt: number | null = null;
        let shown = -1;
        const step = (now: number) => {
          startedAt ??= now;
          const elapsed = Math.floor((now - startedAt) / FRAME_MS) * FRAME_MS;
          const p = Math.min(1, elapsed / durationMs);
          if (p !== shown) {
            shown = p;
            setProgress(p);
          }
          if (p < 1) frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
      },
      { threshold },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [ref, durationMs, reduced, threshold]);
  return reduced ? 1 : progress;
}

export function useAfter(delayMs: number): boolean {
  const reduced = useReducedMotion();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (reduced) return;
    const timer = window.setTimeout(() => setDone(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, reduced]);
  return reduced || done;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
