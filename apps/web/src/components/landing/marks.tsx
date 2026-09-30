import type { ReactNode } from "react";
import { TelegramGlyph } from "@/app/app/Marks";
import { CheckIcon } from "@/components/blog/icons";
import { WhatsAppIcon } from "@/components/WhatsAppIcon";
import { FOCUS } from "./theme";

export type AppKey = "calendar" | "gmail" | "sheets" | "whatsapp" | "flights" | "drive";

const APP_IMAGES: Partial<Record<AppKey, string>> = {
  calendar: "/apps/googlecalendar.webp",
  gmail: "/apps/gmail.webp",
  sheets: "/apps/googlesheets.svg",
  drive: "/apps/googledrive.webp",
};

export function AppMark({ app, className = "h-5 w-5" }: { app: AppKey; className?: string }) {
  const src = APP_IMAGES[app];
  if (src) return <img src={src} alt="" aria-hidden="true" width={20} height={20} className={`${className} shrink-0 object-contain`} />;
  if (app === "whatsapp") return <WhatsAppIcon className={`${className} shrink-0 text-wa-green`} />;
  return <PlaneIcon className={`${className} shrink-0 text-telegram`} />;
}

export function TelegramIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 [&>svg]:h-full [&>svg]:w-full ${className}`}>
      <TelegramGlyph />
    </span>
  );
}

export function ChannelBadges() {
  return (
    <span aria-hidden="true" className="flex items-center">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-wa-green text-white ring-2 ring-(--surface)">
        <WhatsAppIcon className="h-3.5 w-3.5" />
      </span>
      <span className="-ms-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-telegram text-white ring-2 ring-(--surface)">
        <TelegramIcon className="h-3.5 w-3.5" />
      </span>
    </span>
  );
}

export type Playback = "playing" | "paused" | "done";

const PLAYBACK_LABELS: Record<Playback, string> = { playing: "השהיית ההדגמה", paused: "המשך ההדגמה", done: "הפעלת ההדגמה מחדש" };

export function PlaybackButton({ playback, onClick }: { playback: Playback; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={PLAYBACK_LABELS[playback]}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-(--line-2) text-(--ink) transition-colors hover:border-(--ink)/50 hover:bg-(--surface) ${FOCUS}`}
    >
      {playback === "playing" ? (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <path d="M7 5h3v14H7zM14 5h3v14h-3z" />
        </svg>
      ) : playback === "paused" ? (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <path d="M7 4.8v14.4a1 1 0 0 0 1.5.9l11.2-7.2a1 1 0 0 0 0-1.7L8.5 3.9A1 1 0 0 0 7 4.8z" />
        </svg>
      ) : (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 12a8 8 0 1 1-2.34-5.66" />
          <path d="M20 4v5h-5" />
        </svg>
      )}
    </button>
  );
}

export function DoneMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-full bg-sage-pale text-sage-dark ${className}`}>
      <CheckIcon className="h-[60%] w-[60%]" />
    </span>
  );
}

function PlaneIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
    </svg>
  );
}

export function ArrowForward({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

export function ChevronBack({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function Reveal({ shown, className = "", children }: { shown: boolean; className?: string; children: ReactNode }) {
  return (
    <div className={`transition duration-500 ease-(--ease-out) ${shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"} ${className}`}>
      {children}
    </div>
  );
}
