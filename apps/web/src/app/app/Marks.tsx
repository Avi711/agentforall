import type { ReactNode } from "react";

// Hebrew has no letter case and wide tracking breaks word cohesion, so no `uppercase` and minimal tracking.
export const SECTION_LABEL = "text-[11px] font-semibold tracking-[0.06em] text-espresso-light";

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.25" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21" />
    </svg>
  );
}

// currentColor, so the same mark sits on any button or status line.
export function Spinner({ spinning = true, className = "w-4 h-4" }: { spinning?: boolean; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={`${className} shrink-0 ${spinning ? "animate-spin" : ""}`} fill="none">
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeOpacity="0.28" strokeWidth="2" />
      <path d="M17.5 10A7.5 7.5 0 0 0 10 2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function ChevronEnd() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="w-4 h-4 rtl:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M8 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const CLOSE_BUTTON_CLASS =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-espresso-light transition hover:bg-espresso/5 hover:text-espresso focus:outline-none focus-visible:ring-2 focus-visible:ring-terra";

export function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}

export function CloseButton({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label="סגירה" className={`${CLOSE_BUTTON_CLASS} ${className}`}>
      <CloseIcon />
    </button>
  );
}

export function WhatsAppGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.247-.694.247-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.999-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.886 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0 0 20.464 3.488" />
    </svg>
  );
}

export function TelegramGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
    </svg>
  );
}

const BUSY_LABEL_CELL = "col-start-1 row-start-1 inline-flex items-center justify-center gap-1.5";

// Both labels share one grid cell, so the button never resizes on swap; compact pills omit busyText.
export function BusyLabel({ busy, busyText, children }: { busy: boolean; busyText?: string; children: ReactNode }) {
  return (
    <span className="inline-grid">
      <span className={`${BUSY_LABEL_CELL} ${busy ? "invisible" : ""}`}>{children}</span>
      <span className={`${BUSY_LABEL_CELL} ${busy ? "" : "invisible"}`}>
        <Spinner spinning={busy} />
        {busyText}
      </span>
    </span>
  );
}

export type AvatarTone = "warm" | "muted" | "alert";

export function BotAvatar({
  name,
  tone = "warm",
  pulse = false,
  size = "md",
}: {
  name: string;
  tone?: AvatarTone;
  pulse?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const initial = firstGlyph(name);
  const dim =
    size === "lg"
      ? "w-14 h-14 text-[1.75rem] sm:w-20 sm:h-20 sm:text-[2.25rem]"
      : size === "sm"
        ? "w-10 h-10 text-base"
        : "w-16 h-16 text-3xl";
  const dot =
    size === "lg"
      ? "w-3.5 h-3.5 ring-2 sm:w-4 sm:h-4 sm:ring-[3px]"
      : size === "sm"
        ? "w-2.5 h-2.5 ring-2"
        : "w-3.5 h-3.5 ring-2";
  const dotColor =
    tone === "warm"
      ? "bg-sage"
      : tone === "alert"
        ? "bg-terra"
        : "bg-sand";

  return (
    <span aria-hidden="true" className="relative inline-flex shrink-0">
      <span
        className={`${dim} relative flex items-center justify-center rounded-full bg-cream-dark/80 border border-sand-light text-espresso font-display leading-none shadow-[inset_0_-3px_8px_rgba(44,24,16,0.045)]`}
      >
        <span aria-hidden className="absolute inset-1 rounded-full border border-sand-light/70" />
        <span className="relative -mt-[2px] tracking-tight">{initial}</span>
      </span>
      <span
        className={`absolute bottom-0 end-0 ${dot} rounded-full ${dotColor} ring-white ${
          pulse ? "animate-ember" : ""
        }`}
      />
    </span>
  );
}

export function MonogramDisc({
  letter,
  size = "lg",
  children,
}: {
  letter?: string;
  size?: "sm" | "md" | "lg" | "xl";
  children?: ReactNode;
}) {
  const dim =
    size === "xl"
      ? "w-24 h-24 text-[2.5rem]"
      : size === "lg"
        ? "w-20 h-20 text-[2.25rem]"
        : size === "md"
          ? "w-16 h-16 text-3xl"
          : "w-10 h-10 text-xl";
  return (
    <span
      aria-hidden="true"
      className={`${dim} relative flex items-center justify-center rounded-full bg-cream-dark/80 border border-sand-light text-espresso font-display leading-none shadow-[inset_0_-3px_8px_rgba(44,24,16,0.045)]`}
    >
      <span aria-hidden className="absolute inset-1 rounded-full border border-sand-light/70" />
      <span className="relative -mt-[2px] tracking-tight">{children ?? (letter ? firstGlyph(letter) : "")}</span>
    </span>
  );
}

function firstGlyph(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "·";
  const it = trimmed[Symbol.iterator]();
  const first = it.next().value ?? "·";
  return first.toLocaleUpperCase("he-IL");
}

export function SurfaceCard({
  as: Tag = "section",
  id,
  className = "",
  cardRef,
  children,
}: {
  as?: "section" | "article";
  id?: string;
  className?: string;
  cardRef?: React.Ref<HTMLElement>;
  children: React.ReactNode;
}) {
  return (
    <Tag
      id={id}
      ref={cardRef}
      className={`relative bg-white rounded-[28px] border border-sand-light shadow-[0_1px_0_rgba(44,24,16,0.04),0_24px_60px_-32px_rgba(44,24,16,0.18)] overflow-hidden ${className}`}
    >
      {children}
    </Tag>
  );
}

export type Tone = "good" | "warn" | "muted";

const TONE_DOT: Record<Tone, string> = { good: "bg-sage", warn: "bg-terra", muted: "bg-sand" };
const TONE_TEXT: Record<Tone, string> = { good: "text-sage-dark", warn: "text-terra-dark", muted: "text-espresso-light" };

export function StatusLabel({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-2 text-[13px] font-bold ${TONE_TEXT[tone]}`}>
      <span aria-hidden className={`h-2 w-2 rounded-full ${TONE_DOT[tone]}`} />
      {children}
    </span>
  );
}

export function SummaryRows({ rows }: { rows: readonly { label: string; value: ReactNode }[] }) {
  return (
    <dl className="w-full divide-y divide-sand-light/70 rounded-2xl bg-cream px-5 text-start">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-4 py-3.5">
          <dt className="text-sm text-espresso-light">{row.label}</dt>
          <dd className="text-[15px] font-semibold text-espresso tabular-nums">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
