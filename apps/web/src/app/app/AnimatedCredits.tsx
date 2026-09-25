"use client";

import { useEffect, useRef, useState } from "react";
import { countTo, prefersReducedMotion } from "@/components/motion";
import { formatCredits } from "@/lib/billing/format";

const RISE_MS = 900;

export function AnimatedCredits({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);

  useEffect(() => {
    const rises = value > shownRef.current && !prefersReducedMotion();
    return countTo(shownRef.current, value, rises ? RISE_MS : 0, (next) => {
      shownRef.current = next;
      setShown(next);
    });
  }, [value]);

  return (
    <>
      <span className="sr-only">{formatCredits(value)}</span>
      <span aria-hidden>{formatCredits(shown)}</span>
    </>
  );
}
