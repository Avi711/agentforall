import type { ReactNode } from "react";

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

export function OrnamentDivider({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-center gap-2 text-sand ${className}`}
    >
      <span className="h-px w-10 bg-current" />
      <span className="h-1 w-1 rounded-full bg-current" />
      <span className="h-px w-10 bg-current" />
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
      ? "w-20 h-20 text-[2.25rem]"
      : size === "sm"
        ? "w-10 h-10 text-base"
        : "w-16 h-16 text-3xl";
  const dot =
    size === "lg"
      ? "w-4 h-4 ring-[3px]"
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
  size?: "md" | "lg" | "xl";
  children?: ReactNode;
}) {
  const dim =
    size === "xl"
      ? "w-24 h-24 text-[2.5rem]"
      : size === "lg"
        ? "w-20 h-20 text-[2.25rem]"
        : "w-16 h-16 text-3xl";
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
