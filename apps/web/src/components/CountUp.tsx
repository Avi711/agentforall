"use client";

import { useEffect, useRef, useState } from "react";

const DURATION_MS = 1400;

// Counts a formatted number up once it scrolls into view; the label is the resting text everywhere else.
export function CountUp({ label }: { label: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [text, setText] = useState(label);

  useEffect(() => {
    const el = ref.current;
    const target = Number(label.replace(/[^\d]/g, ""));
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.hasAttribute("data-reduced-motion");
    if (!el || !Number.isFinite(target) || still || !("IntersectionObserver" in window)) return;
    let cancelled = false;
    setText("0");
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      observer.disconnect();
      const start = performance.now();
      const tick = (now: number) => {
        if (cancelled) return;
        const p = Math.min(1, (now - start) / DURATION_MS);
        const eased = 1 - Math.pow(1 - p, 3);
        setText(Math.round(target * eased).toLocaleString("he-IL"));
        if (p < 1) requestAnimationFrame(tick);
        else setText(label);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.6 });
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [label]);

  return (
    <>
      <span className="sr-only">{label}</span>
      <span ref={ref} aria-hidden className="tabular-nums">{text}</span>
    </>
  );
}
