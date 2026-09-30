import type { ReactNode } from "react";
import { AGENT_NAME } from "./content";
import { ChevronBack } from "./marks";
import { MICRO } from "./theme";

const BUBBLE = "relative max-w-[86%] rounded-[12px] px-3 py-1.5 text-[15px] leading-[1.45] text-(--wa-ink) shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]";

function Ticks({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 16" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m1.5 8.5 4 4 8.5-9" />
      <path d="m9 11.5 1 1 8.5-9" />
    </svg>
  );
}

function Meta({ time, read }: { time: string; read: boolean }) {
  return (
    <span className="float-left ms-2 mt-1.5 flex items-center gap-1 text-[11px] leading-none text-(--wa-meta)">
      <span className="tabular-nums">{time}</span>
      {read ? <Ticks className="h-3.5 w-3.5 text-(--wa-tick)" /> : null}
    </span>
  );
}

export function OutBubble({ children, time = "09:41", className = "" }: { children: ReactNode; time?: string; className?: string }) {
  return (
    <div className={`${BUBBLE} wa-out self-end bg-(--wa-out) ${className}`}>
      {children}
      <Meta time={time} read />
    </div>
  );
}

export function InBubble({ children, time, className = "" }: { children: ReactNode; time?: string; className?: string }) {
  return (
    <div className={`${BUBBLE} wa-in self-start bg-(--wa-in) ${className}`}>
      {children}
      {time ? <Meta time={time} read={false} /> : null}
    </div>
  );
}

export function DayChip({ children = "היום" }: { children?: ReactNode }) {
  return <span className={`${MICRO} self-center rounded-[12px] bg-(--wa-chip) px-2.5 py-1 font-medium text-(--wa-chip-ink) shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]`}>{children}</span>;
}

export function Avatar({ name = AGENT_NAME, className = "h-9 w-9 text-base" }: { name?: string; className?: string }) {
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-full bg-terra-light font-display text-white ${className}`}>
      {name.charAt(0)}
    </span>
  );
}

export function ChatHeader({ name = AGENT_NAME, status = "מחובר", tint = false }: { name?: string; status?: string; tint?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 bg-(--wa-header) px-3 py-2.5 text-(--wa-header-ink)">
      <ChevronBack className="h-5 w-5 shrink-0" />
      <Avatar name={name} className={tint ? "h-9 w-9 bg-white/20 text-base" : "h-9 w-9 text-base"} />
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-[16px] font-semibold">{name}</span>
        <span className={`${MICRO} text-white/85`}>{status}</span>
      </div>
      <span className="ms-auto flex shrink-0 items-center gap-4 text-white/95">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 10h4l3-3v10l-3-3h-4M2 7h13v10H2z" />
        </svg>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6.1 6.1l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.8 2z" />
        </svg>
      </span>
    </div>
  );
}

export function Composer({ text = "", placeholder = "הודעה" }: { text?: string; placeholder?: string }) {
  return (
    <div className="flex shrink-0 items-center gap-2 bg-(--wa-bar) px-2.5 py-2">
      <span className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-(--wa-input) px-3.5 text-[15px] text-(--wa-ink) contain-inline-size">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-(--wa-chip-ink)" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 10h.01M15 10h.01" />
        </svg>
        {text ? (
          <span className="min-w-0 truncate">
            {text}
            <span aria-hidden="true" className="ms-px inline-block h-4 w-px translate-y-0.5 animate-pulse bg-(--wa-ink)" />
          </span>
        ) : (
          <span className="text-(--wa-meta)">{placeholder}</span>
        )}
      </span>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-(--wa-header) text-white">
        {text ? (
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 -scale-x-100" fill="currentColor">
            <path d="M2 21 23 12 2 3v7l15 2-15 2z" />
          </svg>
        ) : (
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <rect x="9" y="3" width="6" height="12" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
        )}
      </span>
    </div>
  );
}

export function TypingDots() {
  return (
    <span aria-hidden="true" className="flex items-center gap-1 py-2">
      {[0, 1, 2].map((i) => (
        <span key={i} className="typing-dot h-1.5 w-1.5 rounded-full bg-(--wa-meta)" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </span>
  );
}

export function Phone({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative rounded-[44px] bg-(--phone-bezel) p-[10px] shadow-(--phone-shadow) ${className}`}>
      <span aria-hidden="true" className="absolute inset-x-0 top-[14px] mx-auto h-[22px] w-[92px] rounded-full bg-(--phone-bezel)" />
      <div className="flex h-full flex-col overflow-hidden rounded-[34px] bg-white contain-inline-size">{children}</div>
    </div>
  );
}

export function StatusBar({ time = "9:41", dark = false }: { time?: string; dark?: boolean }) {
  return (
    <div dir="ltr" className={`flex items-center justify-between px-6 pb-1 pt-3 text-[13px] font-semibold ${dark ? "bg-(--wa-header) text-white" : "text-(--wa-ink)"}`}>
      <span className="tabular-nums">{time}</span>
      <span className="flex items-center gap-1.5">
        <svg aria-hidden="true" viewBox="0 0 18 12" className="h-3 w-4" fill="currentColor">
          <rect x="0" y="8" width="3" height="4" rx="0.5" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="0.5" />
          <rect x="10" y="3" width="3" height="9" rx="0.5" />
          <rect x="15" y="0" width="3" height="12" rx="0.5" />
        </svg>
        <svg aria-hidden="true" viewBox="0 0 26 12" className="h-3 w-6" fill="none" stroke="currentColor" strokeWidth="1.2">
          <rect x="0.6" y="0.6" width="21" height="10.8" rx="3" />
          <rect x="2.4" y="2.4" width="16" height="7.2" rx="1.6" fill="currentColor" stroke="none" />
          <path d="M23.5 4v4" strokeLinecap="round" />
        </svg>
      </span>
    </div>
  );
}
