"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DeleteBotDialog } from "./DeleteBotDialog";
import { useBotStatus, type BotSnapshot } from "./useBotStatus";
import { BotAvatar, type AvatarTone } from "./Marks";
import { CreatingPanel } from "./CreatingPanel";

export function BotCard({ bot: initialBot }: { bot: BotSnapshot }) {
  const router = useRouter();
  const bot = useBotStatus(initialBot);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const state = resolveState(bot);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  async function handleDelete() {
    const res = await fetch(`/api/bot/${bot.id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 204) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error?.message ?? "מחיקה נכשלה");
    }
    setDialogOpen(false);
    router.refresh();
  }

  if (bot.status === "provisioning") {
    return <CreatingPanel name={bot.displayName} />;
  }

  return (
    <>
      <article className="relative bg-white rounded-[28px] border border-sand-light shadow-[0_1px_0_rgba(44,24,16,0.04),0_24px_60px_-32px_rgba(44,24,16,0.18)] overflow-hidden">
        <span aria-hidden className="absolute top-0 inset-x-12 h-px bg-gradient-to-r from-transparent via-sand-light to-transparent" />

        <div className="p-8 sm:p-10">
          <div className="flex items-start justify-between gap-6 mb-7">
            <div className="flex items-start gap-5 min-w-0">
              <BotAvatar
                name={bot.displayName}
                tone={avatarTone(state.kind)}
                pulse={state.pulse ?? false}
                size="lg"
              />
              <div className="min-w-0 pt-1">
                <p className="text-xs uppercase tracking-[0.22em] text-espresso-light/70 mb-1.5">
                  הסוכן שלי
                </p>
                <h2 className="font-display text-3xl text-espresso leading-tight truncate">
                  {bot.displayName}
                </h2>
                <div className="mt-3">
                  <StatusBadge kind={state.kind} label={state.label} pulse={state.pulse} />
                </div>
              </div>
            </div>

            <div className="relative" ref={menuRef}>
              <button
                type="button"
                aria-label="פעולות נוספות"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
                className="w-9 h-9 rounded-full flex items-center justify-center text-espresso-light hover:bg-cream-dark hover:text-espresso focus:outline-none focus-visible:ring-2 focus-visible:ring-terra transition"
              >
                <MoreIcon />
              </button>
              {menuOpen ? (
                <div
                  role="menu"
                  className="absolute top-full mt-2 end-0 w-48 rounded-xl border border-sand-light bg-white shadow-[0_8px_24px_rgba(44,24,16,0.08)] overflow-hidden z-10"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setDialogOpen(true);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-700 hover:bg-red-50 transition"
                  >
                    <TrashIcon />
                    <span>מחיקת הבוט</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {bot.whatsappAccountId ? (
            <PhoneRow accountId={bot.whatsappAccountId} />
          ) : null}

          {state.kind === "ok" && bot.whatsappAccountId ? (
            <ReadyActions accountId={bot.whatsappAccountId} />
          ) : state.cta ? (
            <Link
              href={state.cta.href}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-terra text-white font-medium hover:bg-terra-light transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            >
              <span>{state.cta.label}</span>
              <ChevronEnd />
            </Link>
          ) : null}
        </div>
      </article>

      <DeleteBotDialog
        open={dialogOpen}
        botName={bot.displayName}
        onClose={() => setDialogOpen(false)}
        onConfirm={handleDelete}
      />
    </>
  );
}

function PhoneRow({ accountId }: { accountId: string }) {
  const [copied, setCopied] = useState(false);
  const display = `+${accountId}`;
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(display);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (insecure context). Number remains visible.
    }
  };
  return (
    <div className="mb-7 -mx-1 px-1">
      <p className="text-[11px] uppercase tracking-[0.22em] text-espresso-light/70 mb-2">
        WhatsApp מחובר
      </p>
      <div className="flex items-center gap-2.5">
        <span dir="ltr" className="font-mono text-lg text-espresso">{display}</span>
        <button
          type="button"
          onClick={onCopy}
          aria-label={copied ? "המספר הועתק" : "העתקת המספר"}
          className="rounded-md p-1.5 text-espresso-light hover:text-espresso hover:bg-cream-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-terra transition"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>
    </div>
  );
}

function ReadyActions({ accountId }: { accountId: string }) {
  const waLink = `https://wa.me/${accountId}?text=${encodeURIComponent("שלום!")}`;
  return (
    <div className="space-y-4 border-t border-sand-light/70 pt-7">
      <a
        href={waLink}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl bg-terra text-white font-medium hover:bg-terra-light transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-2 focus-visible:ring-offset-white"
      >
        <WhatsAppGlyph />
        <span>פתחו ב-WhatsApp ושלחו הודעה</span>
      </a>
      <p className="text-xs text-espresso-light leading-relaxed max-w-md italic">
        ההודעה הראשונה עשויה להגיע אחרי כ-30–40 שניות — הסוכן עולה ברגעים אלו.
        ההודעות הבאות יענו מיידית.
      </p>
    </div>
  );
}

function MoreIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="w-5 h-5" fill="currentColor">
      <circle cx="10" cy="4" r="1.5" />
      <circle cx="10" cy="10" r="1.5" />
      <circle cx="10" cy="16" r="1.5" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 6h12M8 6V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2M6 6v10a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="6" y="6" width="10" height="10" rx="1.5" />
      <path d="M4 14V5a1 1 0 0 1 1-1h9" strokeLinecap="round" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 10l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ChevronEnd() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="w-4 h-4 rtl:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M8 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function WhatsAppGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.247-.694.247-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.999-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.886 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0 0 20.464 3.488"/>
    </svg>
  );
}

function StatusBadge({
  kind,
  label,
  pulse,
}: {
  kind: "ok" | "warn" | "err" | "info";
  label: string;
  pulse?: boolean;
}) {
  const tone =
    kind === "ok"
      ? "bg-sage-pale/70 text-sage-dark border-sage-light/40"
      : kind === "warn"
        ? "bg-terra-pale/70 text-terra border-terra-light/40"
        : kind === "err"
          ? "bg-red-50 text-red-700 border-red-200"
          : "bg-cream-dark/70 text-espresso-light border-sand-light";
  return (
    <span
      className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-medium tracking-wide border ${tone}`}
    >
      <span aria-hidden className="relative flex w-1.5 h-1.5">
        {pulse ? (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
        ) : null}
        <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-current" />
      </span>
      {label}
    </span>
  );
}

interface BotState {
  kind: "ok" | "warn" | "err" | "info";
  label: string;
  cta: { href: string; label: string } | null;
  pulse?: boolean;
}

function avatarTone(kind: BotState["kind"]): AvatarTone {
  if (kind === "ok") return "warm";
  if (kind === "err") return "alert";
  return "muted";
}

function resolveState(bot: BotSnapshot): BotState {
  if (bot.status === "provisioning") {
    return { kind: "info", label: "מכין את הסוכן…", cta: null, pulse: true };
  }
  if (bot.status === "error") {
    return { kind: "err", label: "שגיאה", cta: null };
  }
  if (bot.pairingStatus === "paired" && bot.hasWhatsappCreds) {
    if (bot.lastSeenAt === null) {
      return { kind: "info", label: "מתחבר ל-WhatsApp… (עד 2 דקות)", cta: null, pulse: true };
    }
    if (bot.status === "degraded") {
      return { kind: "warn", label: "חיבור לא יציב — מנסה להתאושש", cta: null, pulse: true };
    }
    if (bot.status === "unhealthy") {
      return { kind: "err", label: "הסוכן לא מגיב — מנסים לתקן", cta: null, pulse: true };
    }
    return { kind: "ok", label: "מחובר ופעיל", cta: null };
  }
  if (
    bot.pairingStatus === "awaiting_qr" ||
    bot.pairingStatus === "awaiting_code"
  ) {
    return {
      kind: "warn",
      label: "ממתין להתאמה",
      cta: { href: "/app/bot/pair", label: "המשך התאמה" },
    };
  }
  if (bot.pairingStatus === "failed" || bot.pairingStatus === "expired") {
    return {
      kind: "warn",
      label: "לא מחובר ל-WhatsApp",
      cta: { href: "/app/bot/pair", label: "חיבור מחדש" },
    };
  }
  return {
    kind: "info",
    label: "מוכן לחיבור WhatsApp",
    cta: { href: "/app/bot/pair", label: "חיבור WhatsApp" },
  };
}
