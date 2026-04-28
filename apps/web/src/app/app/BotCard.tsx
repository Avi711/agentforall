"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Instance } from "@/lib/orchestrator/types";
import { DeleteBotDialog } from "./DeleteBotDialog";

type BotSnapshot = Pick<
  Instance,
  | "id"
  | "displayName"
  | "status"
  | "pairingStatus"
  | "whatsappAccountId"
  | "hasWhatsappCreds"
> & { lastSeenAt: string | null };

export function BotCard({ bot }: { bot: BotSnapshot }) {
  const router = useRouter();
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

  return (
    <>
      <div className="bg-white rounded-2xl shadow-sm border border-sand-light p-8 relative">
        <div className="flex items-start justify-between gap-6 mb-6">
          <div>
            <h2 className="font-display text-2xl text-espresso mb-1">
              {bot.displayName}
            </h2>
            <StatusBadge kind={state.kind} label={state.label} />
          </div>

          <div className="flex items-center gap-3">
            <span aria-hidden className="text-5xl select-none">🤖</span>
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                aria-label="פעולות נוספות"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
                className="w-9 h-9 rounded-full flex items-center justify-center text-espresso-light hover:bg-cream-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-terra transition"
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
        </div>

        {bot.whatsappAccountId ? (
          <p className="text-sm text-espresso-light mb-6">
            מחובר למספר{" "}
            <span dir="ltr" className="font-mono">
              +{bot.whatsappAccountId}
            </span>
          </p>
        ) : null}

        {state.cta ? (
          <Link
            href={state.cta.href}
            className="inline-flex px-5 py-2.5 rounded-xl bg-terra text-white font-medium hover:bg-terra-light transition"
          >
            {state.cta.label}
          </Link>
        ) : null}
      </div>

      <DeleteBotDialog
        open={dialogOpen}
        botName={bot.displayName}
        onClose={() => setDialogOpen(false)}
        onConfirm={handleDelete}
      />
    </>
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

function StatusBadge({
  kind,
  label,
}: {
  kind: "ok" | "warn" | "err" | "info";
  label: string;
}) {
  const tone =
    kind === "ok"
      ? "bg-sage-pale text-sage-dark"
      : kind === "warn"
        ? "bg-terra-pale text-terra"
        : kind === "err"
          ? "bg-red-50 text-red-700"
          : "bg-cream-dark text-espresso-light";
  return (
    <span
      className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${tone}`}
    >
      <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

interface BotState {
  kind: "ok" | "warn" | "err" | "info";
  label: string;
  cta: { href: string; label: string } | null;
}

function resolveState(bot: BotSnapshot): BotState {
  if (bot.status === "provisioning") {
    return { kind: "info", label: "מכין את הסוכן…", cta: null };
  }
  if (bot.status === "error") {
    return { kind: "err", label: "שגיאה", cta: null };
  }
  if (bot.pairingStatus === "paired" && bot.hasWhatsappCreds) {
    return {
      kind: "ok",
      label: "מחובר ופעיל",
      cta: null,
    };
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
