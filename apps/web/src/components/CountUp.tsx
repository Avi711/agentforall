"use client";

import { useEffect, useRef, useState } from "react";
import { countTo, prefersReducedMotion } from "./motion";

const DURATION_MS = 1400;

// Counts a formatted number up once it scrolls into view; the label is the resting text everywhere else.
export function CountUp({ label }: { label: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [text, setText] = useState(label);

  useEffect(() => {
    const el = ref.current;
    const target = Number(label.replace(/[^\d]/g, ""));
    if (!el || !Number.isFinite(target) || prefersReducedMotion() || !("IntersectionObserver" in window)) return;
    let cancel = () => {};
    setText("0");
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        observer.disconnect();
        cancel = countTo(0, target, DURATION_MS, (value) => setText(value === target ? label : value.toLocaleString("he-IL")));
      },
      { threshold: 0.6 },
    );
    observer.observe(el);
    return () => {
      cancel();
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
