"use client";

import { useEffect, useId, useRef, useState } from "react";

// A real button rather than title=: works on touch and keyboards. Hover previews, tap pins.
export function InfoHint({ label, text }: { label: string; text: string }) {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  const open = pinned || hovered;

  useEffect(() => {
    if (!pinned) return;
    const onPointer = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setPinned(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinned(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

  return (
    <span
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setPinned((v) => !v)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        className="w-7 h-7 -my-1.5 inline-flex items-center justify-center rounded-full text-espresso-light/60 hover:text-espresso hover:bg-cream-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-terra transition"
      >
        <InfoIcon />
      </button>
      {open ? (
        <span
          role="tooltip"
          id={id}
          className="absolute top-full mt-1.5 start-0 z-30 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-sand-light bg-white px-3.5 py-2.5 text-xs font-normal leading-relaxed text-espresso shadow-[0_8px_24px_rgba(44,24,16,0.1)]"
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}

function InfoIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 9v4.5M10 6.5h.01" strokeLinecap="round" />
    </svg>
  );
}
