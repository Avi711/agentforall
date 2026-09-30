import { useSyncExternalStore } from "react";

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.hasAttribute("data-reduced-motion");
}

function subscribeReducedMotion(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-reduced-motion"] });
  return () => {
    media.removeEventListener("change", onChange);
    observer.disconnect();
  };
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
}

export function countTo(from: number, to: number, durationMs: number, onValue: (value: number) => void): () => void {
  let frame = 0;
  let startedAt: number | null = null;
  const step = (now: number) => {
    startedAt ??= now;
    const progress = durationMs > 0 ? Math.min(1, (now - startedAt) / durationMs) : 1;
    onValue(Math.round(from + (to - from) * (1 - (1 - progress) ** 3)));
    if (progress < 1) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}
