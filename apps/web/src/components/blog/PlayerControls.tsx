"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type Ref } from "react";
import type { VideoChapter } from "@/lib/blog";
import { CheckIcon } from "./icons";

export const SEEK_STEP_SEC = 5;
const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;
const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function chapterAt(chapters: VideoChapter[], time: number): number {
  let index = 0;
  chapters.forEach((c, i) => {
    if (time >= c.startSec) index = i;
  });
  return index;
}

export function IconButton({ label, onClick, children, buttonRef }: { label: string; onClick: () => void; children: ReactNode; buttonRef?: Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition hover:bg-white/15 ${FOCUS_RING}`}
    >
      {children}
    </button>
  );
}

export function Timeline({
  duration,
  time,
  chapters,
  onSeek,
}: {
  duration: number;
  time: number;
  chapters: VideoChapter[];
  onSeek: (sec: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const spans = chapters.map((c, i) => ({ label: c.label, from: c.startSec, to: chapters[i + 1]?.startSec ?? duration }));

  const timeAt = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1) * duration;
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    onSeek(timeAt(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const t = timeAt(e.clientX);
    if (e.pointerType === "mouse") setHover(t);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) onSeek(t);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowRight: SEEK_STEP_SEC, ArrowUp: SEEK_STEP_SEC, ArrowLeft: -SEEK_STEP_SEC, ArrowDown: -SEEK_STEP_SEC };
    if (e.key in step) onSeek(time + step[e.key]);
    else if (e.key === "Home") onSeek(0);
    else if (e.key === "End") onSeek(duration);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const hoverSpan = hover === null ? null : spans[chapterAt(chapters, hover)];

  return (
    <div
      ref={barRef}
      role="slider"
      tabIndex={0}
      aria-label="מיקום בסרטון"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      aria-valuetext={`${formatTime(time)} מתוך ${formatTime(duration)}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
      onPointerLeave={() => setHover(null)}
      onKeyDown={onKeyDown}
      className="relative flex h-6 cursor-pointer touch-none items-center gap-[3px] rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white"
    >
      {spans.map((s) => {
        const fill = Math.min(Math.max((time - s.from) / (s.to - s.from), 0), 1);
        return (
          <div key={s.from} style={{ flexGrow: s.to - s.from }} className="relative h-[5px] basis-0 overflow-hidden rounded-full bg-white/30">
            <div className="absolute inset-y-0 left-0 rounded-full bg-terra-light" style={{ width: `${fill * 100}%` }} />
          </div>
        );
      })}
      <div
        className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
        style={{ left: `${(Math.min(time, duration) / duration) * 100}%` }}
      />
      {hover !== null && hoverSpan ? (
        <div
          dir="rtl"
          className="pointer-events-none absolute bottom-7 -translate-x-1/2 whitespace-nowrap rounded-lg bg-espresso/90 px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg"
          style={{ left: `${Math.min(Math.max((hover / duration) * 100, 14), 86)}%` }}
        >
          {hoverSpan.label} · <span className="tabular-nums">{formatTime(hover)}</span>
        </div>
      ) : null}
    </div>
  );
}

export function SpeedMenu({
  rate,
  open,
  onOpenChange,
  onPick,
}: {
  rate: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (rate: number) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[Math.max(0, SPEEDS.findIndex((s) => s === rate))]?.focus();
    const onPointerDown = (e: globalThis.PointerEvent) => {
      if (e.target instanceof Node && !rootRef.current?.contains(e.target)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, rate, onOpenChange]);

  const close = () => {
    onOpenChange(false);
    triggerRef.current?.focus();
  };
  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter((el): el is HTMLButtonElement => el !== null);
    const at = items.findIndex((el) => el === document.activeElement);
    const moves: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 };
    if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") e.preventDefault();
      close();
    } else if (e.key in moves) {
      e.preventDefault();
      items[(moves[e.key] + items.length) % items.length]?.focus();
    } else {
      return;
    }
    e.stopPropagation();
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`מהירות ניגון ${rate}`}
        className={`rounded-full px-2.5 py-1.5 text-xs font-bold tabular-nums text-white/90 transition hover:bg-white/15 ${FOCUS_RING} ${open ? "bg-white/15" : ""}`}
      >
        {rate}×
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="מהירות ניגון"
          dir="rtl"
          onKeyDown={onMenuKeyDown}
          className="absolute bottom-full right-0 mb-2 w-36 rounded-2xl bg-espresso/95 p-1.5 text-white shadow-[0_16px_40px_-12px_rgba(0,0,0,0.6)] ring-1 ring-white/10 backdrop-blur"
        >
          {SPEEDS.map((s, i) => {
            const on = s === rate;
            return (
              <button
                key={s}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                tabIndex={-1}
                onClick={() => {
                  onPick(s);
                  close();
                }}
                className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition hover:bg-white/10 focus-visible:bg-white/15 focus-visible:outline-none ${
                  on ? "font-bold" : "text-white/85"
                }`}
              >
                <span className="flex h-4 w-4 items-center justify-center">{on ? <CheckIcon /> : null}</span>
                <span className="tabular-nums" dir="ltr">
                  {s}×
                </span>
                {s === 1 ? <span className="text-xs text-white/60">רגיל</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// The slider pops up above the button, so opening it never shifts the control row.
export function VolumeControl({
  volume,
  onToggleMute,
  onVolume,
}: {
  volume: number;
  onToggleMute: () => void;
  onVolume: (level: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const levelAt = (clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return volume;
    return Math.min(Math.max((rect.bottom - clientY) / rect.height, 0), 1);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    onVolume(levelAt(e.clientY));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) onVolume(levelAt(e.clientY));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowUp: 0.1, ArrowRight: 0.1, ArrowDown: -0.1, ArrowLeft: -0.1 };
    if (!(e.key in step)) return;
    e.preventDefault();
    e.stopPropagation();
    onVolume(volume + step[e.key]);
  };

  return (
    <div className="group/vol relative shrink-0">
      <IconButton label={volume === 0 ? "הפעלת קול" : "השתקה"} onClick={onToggleMute}>
        {volume === 0 ? <MutedIcon /> : <VolumeIcon />}
      </IconButton>
      <div className="invisible absolute bottom-full left-1/2 -translate-x-1/2 pb-2 opacity-0 transition-opacity duration-150 group-focus-within/vol:visible group-focus-within/vol:opacity-100 group-hover/vol:visible group-hover/vol:opacity-100 pointer-coarse:hidden">
        <div className="rounded-2xl bg-espresso/95 px-2 py-3 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.6)] ring-1 ring-white/10">
          <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label="עוצמת קול"
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(volume * 100)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
            onKeyDown={onKeyDown}
            className="relative flex h-24 w-6 cursor-pointer touch-none justify-center outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-white"
          >
            <div className="relative h-full w-1 rounded-full bg-white/30">
              <div className="absolute inset-x-0 bottom-0 rounded-full bg-white" style={{ height: `${volume * 100}%` }} />
            </div>
            <div
              className="pointer-events-none absolute left-1/2 h-3 w-3 -translate-x-1/2 translate-y-1/2 rounded-full bg-white shadow"
              style={{ bottom: `${volume * 100}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function PauseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-current">
      <rect x="6" y="4.5" width="4" height="15" rx="1.2" />
      <rect x="14" y="4.5" width="4" height="15" rx="1.2" />
    </svg>
  );
}

function VolumeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
      <path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" />
    </svg>
  );
}

function MutedIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
      <path d="M16 9.5l5 5M21 9.5l-5 5" />
    </svg>
  );
}

export function ExpandIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  );
}

export function CollapseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
    </svg>
  );
}

export function ReplayIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" />
    </svg>
  );
}
