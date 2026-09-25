"use client";

import { useCallback, type ReactNode } from "react";

export function ErrorAlert({ children, className = "" }: { children: ReactNode; className?: string }) {
  // An error raised under a long form must not appear off screen.
  const reveal = useCallback((element: HTMLParagraphElement | null) => element?.scrollIntoView({ block: "nearest" }), []);
  if (!children) return null;
  return (
    <p ref={reveal} role="alert" className={`rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 ${className}`}>
      {children}
    </p>
  );
}
