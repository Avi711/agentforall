"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DeleteBotDialog } from "./DeleteBotDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { useBotStatus, type BotSnapshot } from "./useBotStatus";
import { BotAvatar, type AvatarTone } from "./Marks";
import { CreatingPanel } from "./CreatingPanel";
import { WhatsAppAccessSection } from "./WhatsAppAccessSection";
import type { BotUsage } from "@/lib/orchestrator/types";

const USD_TO_ILS_RATE = 3;
const USAGE_LABEL = "נוצל";
const LIMIT_LABEL = "מסגרת";
const NO_LIMIT_LABEL = "ללא מסגרת";
const CURRENT_PERIOD_LABEL = "התקופה הנוכחית";
const PERIOD_LABEL = "תקופה";
const THIRTY_DAYS_LABEL = "30 יום";

type Channel = "whatsapp" | "telegram";

export function BotCard({
  bot: initialBot,
  usage,
}: {
  bot: BotSnapshot;
  usage: BotUsage | null;
}) {
  const router = useRouter();
  const bot = useBotStatus(initialBot);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState<Channel | null>(null);
  const [cancelPending, setCancelPending] = useState<Channel | null>(null);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [downloadPending, setDownloadPending] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [restartPending, setRestartPending] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
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

  async function disconnectChannel(channel: Channel) {
    const res = await fetch(`/api/bot/${bot.id}/${channel}/disconnect`, {
      method: "POST",
      cache: "no-store",
    });
    if (!res.ok && res.status !== 204) {
      throw new Error(
        res.status === 409
          ? "הבוט עסוק כרגע — נסו שוב בעוד רגע."
          : channel === "whatsapp"
            ? "ניתוק WhatsApp נכשל"
            : "ניתוק טלגרם נכשל",
      );
    }
  }

  async function handleDisconnectConfirm() {
    if (!disconnecting) return;
    await disconnectChannel(disconnecting);
    setDisconnecting(null);
    router.refresh();
  }

  // Cancelling a pairing/link that never completed is low-stakes: no confirm dialog.
  async function handleCancelPending(channel: Channel) {
    if (cancelPending) return;
    setCancelPending(channel);
    setChannelError(null);
    try {
      await disconnectChannel(channel);
      router.refresh();
    } catch (err) {
      setChannelError(err instanceof Error ? err.message : "הפעולה נכשלה");
    } finally {
      setCancelPending(null);
    }
  }

  async function handleExport() {
    if (downloadPending) return;

    setDownloadPending(true);
    setDownloadError(null);

    try {
      const res = await fetch(`/api/bot/${bot.id}/export`, {
        method: "POST",
        cache: "no-store",
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error("הורדת הגיבוי נכשלה");
      }
      const downloadUrl = await waitForExportDownloadUrl(bot.id, body);

      setDownloadPending(false);
      window.location.assign(downloadUrl);
    } catch (err) {
      setDownloadPending(false);
      setDownloadError(
        err instanceof Error
          ? err.message
          : "הורדת הגיבוי נכשלה",
      );
    }
  }

  async function handleRestart() {
    if (restartPending) return;
    setRestartPending(true);
    setRestartError(null);
    try {
      const res = await fetch(`/api/bot/${bot.id}/restart`, {
        method: "POST",
        cache: "no-store",
      });
      if (!res.ok && res.status !== 204) {
        throw new Error("הפעלת הבוט מחדש נכשלה");
      }
      router.refresh();
    } catch (err) {
      setRestartError(
        err instanceof Error ? err.message : "הפעלת הבוט מחדש נכשלה",
      );
    } finally {
      setRestartPending(false);
    }
  }

  if (bot.status === "provisioning") {
    return <CreatingPanel name={bot.displayName} />;
  }

  return (
    <>
      <article className="relative bg-white rounded-[28px] border border-sand-light shadow-[0_1px_0_rgba(44,24,16,0.04),0_24px_60px_-32px_rgba(44,24,16,0.18)] overflow-hidden">
        <span aria-hidden className="absolute top-0 inset-x-12 h-px bg-gradient-to-r from-transparent via-sand-light to-transparent" />
        {downloadPending ? (
          <span aria-hidden className="download-card-progress" />
        ) : null}

        <div className="p-5 sm:p-10">
          {/* Wraps to avatar+menu / full-width name on narrow screens; single row from sm up. */}
          <div className="flex flex-wrap items-start gap-x-3 gap-y-4 sm:flex-nowrap sm:gap-x-5 mb-6 sm:mb-7">
            <BotAvatar
              name={bot.displayName}
              tone={avatarTone(state.kind)}
              pulse={state.pulse ?? false}
              size="lg"
            />

            <div className="order-3 w-full min-w-0 sm:order-2 sm:w-auto sm:flex-1 sm:pt-1">
              <p className="text-xs uppercase tracking-[0.22em] text-espresso-light/70 mb-1.5">
                הסוכן שלי
              </p>
              <h2 className="font-display text-2xl sm:text-3xl text-espresso leading-tight text-balance break-words">
                {bot.displayName}
              </h2>
              <div className="mt-3">
                <StatusBadge kind={state.kind} label={state.label} pulse={state.pulse} />
              </div>
            </div>

            <div className="relative order-2 ms-auto shrink-0 -me-1.5 -mt-1.5 sm:order-3 sm:ms-0" ref={menuRef}>
              <button
                type="button"
                aria-label="פעולות נוספות"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
                className="w-11 h-11 rounded-full flex items-center justify-center text-espresso-light hover:bg-cream-dark hover:text-espresso focus:outline-none focus-visible:ring-2 focus-visible:ring-terra transition"
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
                    aria-busy={downloadPending}
                    disabled={downloadPending}
                    onClick={() => {
                      setMenuOpen(false);
                      handleExport();
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-espresso hover:bg-cream-dark transition disabled:cursor-wait disabled:bg-terra-pale disabled:text-terra"
                  >
                    {downloadPending ? <DownloadSpinner /> : <DownloadIcon />}
                    <span>הורדת גיבוי</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setDialogOpen(true);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-700 hover:bg-red-50 transition"
                  >
                    <TrashIcon />
                    <span>מחיקת הבוט</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {downloadPending ? (
            <div
              role="status"
              aria-live="polite"
              className="mb-6 flex items-center gap-3 rounded-xl border border-terra-light/30 bg-terra-pale/70 px-4 py-3 text-sm text-terra shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]"
            >
              <DownloadSpinner />
              <div className="min-w-0">
                <p className="font-medium leading-tight">
                  {"אנחנו מכינים את קבצי הגיבוי של הבוט."}
                </p>
                <p className="mt-1 text-xs text-espresso-light/75">
                  {"זה לוקח בדרך כלל עד דקה."}
                </p>
              </div>
              <span aria-hidden className="ms-auto flex gap-1">
                <span className="download-dot" />
                <span className="download-dot [animation-delay:120ms]" />
                <span className="download-dot [animation-delay:240ms]" />
              </span>
            </div>
          ) : null}

          {[downloadError, restartError, channelError].map((message, i) =>
            message ? (
              <div
                key={i}
                role="alert"
                className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {message}
              </div>
            ) : null,
          )}

          <ChannelsSection
            bot={bot}
            cancelPending={cancelPending}
            onDisconnect={(channel) => setDisconnecting(channel)}
            onCancelPending={handleCancelPending}
          />

          {usage?.supported ? <UsageSection usage={usage} /> : null}

          {state.restart ? (
            <button
              type="button"
              onClick={handleRestart}
              disabled={restartPending}
              className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-5 py-3 rounded-xl bg-terra text-white font-medium hover:bg-terra-light transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:opacity-60 disabled:cursor-wait"
            >
              {restartPending ? <DownloadSpinner /> : null}
              <span>{restartPending ? "מפעיל מחדש…" : "הפעלת הבוט מחדש"}</span>
            </button>
          ) : null}
        </div>
      </article>

      <DeleteBotDialog
        open={dialogOpen}
        botName={bot.displayName}
        onClose={() => setDialogOpen(false)}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={disconnecting !== null}
        title={disconnecting === "telegram" ? "ניתוק טלגרם" : "ניתוק WhatsApp"}
        description={
          disconnecting === "telegram" ? (
            <p>
              הבוט{" "}
              {bot.telegram?.botUsername ? (
                <span dir="ltr" className="font-mono text-espresso">@{bot.telegram.botUsername}</span>
              ) : (
                "בטלגרם"
              )}{" "}
              יושבת ויפסיק לענות. הזיכרון וההיסטוריה נשמרים; חיבור מחדש ייצור בוט טלגרם חדש
              בלחיצה אחת.
            </p>
          ) : (
            <p>
              הבוט יפסיק לענות בוואטסאפ והמכשיר המקושר יוסר מהטלפון. הזיכרון, ההיסטוריה
              וההגדרות נשמרים — אפשר לחבר מחדש בכל רגע.
            </p>
          )
        }
        confirmLabel="ניתוק"
        busyLabel="מנתק…"
        onClose={() => setDisconnecting(null)}
        onConfirm={handleDisconnectConfirm}
      />
    </>
  );
}

function ChannelsSection({
  bot,
  cancelPending,
  onDisconnect,
  onCancelPending,
}: {
  bot: BotSnapshot;
  cancelPending: Channel | null;
  onDisconnect: (channel: Channel) => void;
  onCancelPending: (channel: Channel) => void;
}) {
  const health = channelHealth(bot);
  const whatsapp = whatsappRow(bot, health);
  const telegram = telegramRow(bot, health);
  const anyConnected = whatsapp.connected || telegram.connected;

  return (
    <section className="mb-6 sm:mb-7" aria-labelledby="channels-title">
      <p id="channels-title" className="text-[11px] uppercase tracking-[0.22em] text-espresso-light/70 mb-2">
        ערוצים
      </p>
      <ul className="border-t border-sand-light/70 divide-y divide-sand-light/70">
        <ChannelRow
          glyph={<WhatsAppGlyph />}
          name="WhatsApp"
          status={whatsapp.status}
          detail={
            whatsapp.connected && bot.whatsappAccountId ? (
              <PhoneDetail accountId={bot.whatsappAccountId} />
            ) : null
          }
          primary={whatsapp.primary}
          secondary={
            whatsapp.pending
              ? {
                  label: cancelPending === "whatsapp" ? "מבטל…" : "ביטול ההתאמה",
                  disabled: cancelPending !== null,
                  onClick: () => onCancelPending("whatsapp"),
                }
              : whatsapp.connected || whatsapp.stale
                ? { label: "ניתוק", disabled: false, onClick: () => onDisconnect("whatsapp") }
                : null
          }
        >
          {whatsapp.connected && bot.whatsappAccountId && bot.whatsappAccess ? (
            <WhatsAppAccessSection
              botId={bot.id}
              botNumber={`+${bot.whatsappAccountId}`}
              initial={bot.whatsappAccess}
            />
          ) : null}
        </ChannelRow>

        <ChannelRow
          glyph={<TelegramGlyph />}
          name="Telegram"
          status={telegram.status}
          detail={
            telegram.connected && bot.telegram?.botUsername ? (
              <a
                href={`https://t.me/${bot.telegram.botUsername}`}
                target="_blank"
                rel="noopener noreferrer"
                dir="ltr"
                className="inline-block font-mono text-sm text-espresso-light hover:text-terra transition break-all"
              >
                @{bot.telegram.botUsername}
              </a>
            ) : null
          }
          primary={telegram.primary}
          secondary={
            telegram.pending
              ? {
                  label: cancelPending === "telegram" ? "מבטל…" : "ביטול החיבור",
                  disabled: cancelPending !== null,
                  onClick: () => onCancelPending("telegram"),
                }
              : telegram.connected
                ? { label: "ניתוק", disabled: false, onClick: () => onDisconnect("telegram") }
                : null
          }
        />
      </ul>
      {anyConnected && bot.lastSeenAt === null ? (
        <p className="mt-3 text-xs text-espresso-light leading-relaxed max-w-md italic">
          ההודעה הראשונה עשויה להגיע אחרי כ-30–40 שניות — הסוכן עולה ברגעים אלו. ההודעות
          הבאות יענו מיידית.
        </p>
      ) : null}
    </section>
  );
}

interface RowStatus {
  tone: "ok" | "warn" | "err" | "info";
  label: string;
  pulse?: boolean;
}

interface RowAction {
  label: string;
  href: string;
  external?: boolean;
  emphasis: "primary" | "secondary";
}

interface RowModel {
  status: RowStatus;
  connected: boolean;
  pending: boolean;
  stale: boolean;
  primary: RowAction | null;
}

// Container-level health applies to every channel at once.
function channelHealth(bot: BotSnapshot): RowStatus | null {
  if (bot.status === "unhealthy") return { tone: "err", label: "לא מגיב" };
  if (bot.status === "degraded") return { tone: "warn", label: "חיבור לא יציב", pulse: true };
  return null;
}

function whatsappRow(bot: BotSnapshot, health: RowStatus | null): RowModel {
  const pairing = bot.pairingStatus;
  if (pairing === "paired" && bot.hasWhatsappCreds) {
    const status: RowStatus =
      health ??
      (bot.lastSeenAt === null
        ? { tone: "info", label: "מתחבר… (עד 2 דקות)", pulse: true }
        : { tone: "ok", label: "מחובר" });
    return {
      status,
      connected: true,
      pending: false,
      stale: false,
      primary: bot.whatsappAccountId
        ? {
            label: "פתיחה ב-WhatsApp",
            href: `https://wa.me/${bot.whatsappAccountId}?text=${encodeURIComponent("שלום!")}`,
            external: true,
            emphasis: "primary",
          }
        : null,
    };
  }
  if (pairing === "awaiting_qr" || pairing === "awaiting_code") {
    return {
      status: { tone: "warn", label: "ממתין להתאמה", pulse: true },
      connected: false,
      pending: true,
      stale: false,
      primary: { label: "המשך התאמה", href: "/app/bot/pair", emphasis: "secondary" },
    };
  }
  // A dropped live session (creds still stored) is worth a reconnect; a cancelled attempt is just "not connected".
  if ((pairing === "expired" || pairing === "failed") && bot.hasWhatsappCreds) {
    return {
      status: { tone: "warn", label: "החיבור נותק" },
      connected: false,
      pending: false,
      stale: true,
      primary: { label: "חיבור מחדש", href: "/app/bot/pair", emphasis: "secondary" },
    };
  }
  return {
    status: { tone: "info", label: "לא מחובר" },
    connected: false,
    pending: false,
    stale: false,
    primary: { label: "חיבור WhatsApp", href: "/app/bot/pair", emphasis: "secondary" },
  };
}

function telegramRow(bot: BotSnapshot, health: RowStatus | null): RowModel {
  if (bot.telegram?.linked && bot.telegram.botUsername) {
    return {
      status: health ?? { tone: "ok", label: "מחובר" },
      connected: true,
      pending: false,
      stale: false,
      primary: {
        label: "פתיחה בטלגרם",
        href: `https://t.me/${bot.telegram.botUsername}`,
        external: true,
        emphasis: "primary",
      },
    };
  }
  if (bot.telegram && !bot.telegram.linked) {
    return {
      status: { tone: "warn", label: "ממתין לחיבור", pulse: true },
      connected: false,
      pending: true,
      stale: false,
      primary: { label: "המשך חיבור", href: "/app/bot/telegram", emphasis: "secondary" },
    };
  }
  return {
    status: { tone: "info", label: "לא מחובר" },
    connected: false,
    pending: false,
    stale: false,
    primary: { label: "חיבור לטלגרם", href: "/app/bot/telegram", emphasis: "secondary" },
  };
}

function ChannelRow({
  glyph,
  name,
  status,
  detail,
  primary,
  secondary,
  children,
}: {
  glyph: ReactNode;
  name: string;
  status: RowStatus;
  detail: ReactNode;
  primary: RowAction | null;
  secondary: { label: string; disabled: boolean; onClick: () => void } | null;
  children?: ReactNode;
}) {
  return (
    <li className="py-4 sm:py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            aria-hidden
            className="shrink-0 w-9 h-9 rounded-full bg-cream-dark text-espresso flex items-center justify-center"
          >
            {glyph}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[15px] font-medium text-espresso">{name}</span>
              <StatusDot {...status} />
            </div>
            {detail ? <div className="mt-0.5">{detail}</div> : null}
          </div>
        </div>
        {primary || secondary ? (
          <div className="flex items-center justify-between gap-3 sm:justify-end sm:shrink-0 ps-12 sm:ps-0">
            {primary ? <ActionLink action={primary} /> : <span />}
            {secondary ? (
              <button
                type="button"
                disabled={secondary.disabled}
                onClick={secondary.onClick}
                className="py-2 text-sm text-espresso-light underline-offset-4 hover:text-espresso hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-terra rounded disabled:opacity-60 disabled:cursor-wait"
              >
                {secondary.label}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {children ? <div className="mt-2 sm:ps-12">{children}</div> : null}
    </li>
  );
}

function ActionLink({ action }: { action: RowAction }) {
  const className =
    action.emphasis === "primary"
      ? "inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full bg-terra text-white text-sm font-medium hover:bg-terra-light transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-2 focus-visible:ring-offset-white"
      : "inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full border border-sand text-espresso text-sm font-medium hover:bg-cream-dark transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra";
  if (action.external) {
    return (
      <a href={action.href} target="_blank" rel="noopener noreferrer" className={className}>
        <span>{action.label}</span>
        <ArrowOut />
      </a>
    );
  }
  return (
    <Link href={action.href} className={className}>
      <span>{action.label}</span>
      <ChevronEnd />
    </Link>
  );
}

function ArrowOut() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="w-3.5 h-3.5 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M7 13 13 7M8 7h5v5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StatusDot({ tone, label, pulse }: RowStatus) {
  const color =
    tone === "ok"
      ? "text-sage-dark"
      : tone === "warn"
        ? "text-terra"
        : tone === "err"
          ? "text-red-700"
          : "text-espresso-light";
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${color}`}>
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

function PhoneDetail({ accountId }: { accountId: string }) {
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
    <div className="flex items-center gap-1">
      <span dir="ltr" className="font-mono text-sm text-espresso-light break-all">{display}</span>
      <button
        type="button"
        onClick={onCopy}
        aria-label={copied ? "המספר הועתק" : "העתקת המספר"}
        className="shrink-0 w-10 h-10 -my-2.5 inline-flex items-center justify-center rounded-full text-espresso-light/80 hover:text-espresso hover:bg-cream-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-terra transition"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  );
}

function UsageSection({ usage }: { usage: Extract<BotUsage, { supported: true }> }) {
  const percent =
    usage.maxBudgetCents && usage.maxBudgetCents > 0
      ? Math.min(100, Math.round((usage.spendCents / usage.maxBudgetCents) * 100))
      : null;
  return (
    <section className="mb-6 sm:mb-7 border-t border-sand-light/70 pt-6 sm:pt-7">
      <div className="grid grid-cols-2 items-end gap-4 mb-3" dir="ltr">
        <div className="text-left">
          <p className="text-[11px] tracking-[0.16em] text-espresso-light/70 mb-1">
            {LIMIT_LABEL}
          </p>
          <p className="font-medium text-espresso tabular-nums">
            {usage.maxBudgetCents === null ? NO_LIMIT_LABEL : formatShekels(usage.maxBudgetCents)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] tracking-[0.16em] text-espresso-light/70 mb-1">
            {USAGE_LABEL}
          </p>
          <p className="text-2xl font-medium text-espresso tabular-nums">
            {formatShekels(usage.spendCents)}
          </p>
        </div>
      </div>
      <div
        className="h-2 rounded-full bg-cream-dark overflow-hidden"
        dir="rtl"
        role={percent === null ? undefined : "meter"}
        aria-valuemin={percent === null ? undefined : 0}
        aria-valuemax={percent === null ? undefined : 100}
        aria-valuenow={percent === null ? undefined : percent}
      >
        <div
          className="h-full rounded-full bg-terra transition-[width]"
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-4 text-xs text-espresso-light">
        <span>{usage.budgetDuration ? `${PERIOD_LABEL}: ${formatBudgetDuration(usage.budgetDuration)}` : CURRENT_PERIOD_LABEL}</span>
        {percent === null ? null : <span dir="ltr">{percent}%</span>}
      </div>
    </section>
  );
}

function formatShekels(usdCents: number): string {
  const amount = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format((usdCents / 100) * USD_TO_ILS_RATE);
  return `${amount} ₪`;
}

function formatBudgetDuration(duration: string): string {
  if (duration === "30d") return THIRTY_DAYS_LABEL;
  return duration;
}

async function waitForExportDownloadUrl(
  botId: string,
  firstBody: unknown,
): Promise<string> {
  let job = readExportJob(firstBody);
  for (let attempt = 0; attempt < 36; attempt += 1) {
    if (job.status === "ready") return job.downloadUrl;
    if (job.status === "error") {
      throw new Error("הורדת הגיבוי נכשלה");
    }

    await sleep(5000);
    const res = await fetch(
      `/api/bot/${botId}/export?jobId=${encodeURIComponent(job.id)}`,
      { method: "GET", cache: "no-store" },
    );
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error("הורדת הגיבוי נכשלה");
    }
    job = readExportJob(body);
  }

  throw new Error("הורדת הגיבוי לא הסתיימה בזמן.");
}

type ExportJob =
  | { id: string; status: "pending" }
  | { id: string; status: "ready"; downloadUrl: string }
  | { id: string; status: "error" };

function readExportJob(body: unknown): ExportJob {
  if (
    typeof body === "object" &&
    body !== null &&
    "id" in body &&
    typeof (body as { id?: unknown }).id === "string" &&
    "status" in body
  ) {
    const raw = body as { id: string; status?: unknown; downloadUrl?: unknown };
    if (raw.status === "pending") return { id: raw.id, status: "pending" };
    if (raw.status === "error") return { id: raw.id, status: "error" };
    if (raw.status === "ready" && typeof raw.downloadUrl === "string") {
      return { id: raw.id, status: "ready", downloadUrl: raw.downloadUrl };
    }
  }
  throw new Error("הורדת הגיבוי נכשלה");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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
function DownloadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M10 3v9M6.5 8.5 10 12l3.5-3.5M4 16h12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function DownloadSpinner() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="download-spinner w-4 h-4" fill="none">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M17 10a7 7 0 0 0-7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M10 7v5M7.8 10.2 10 12.4l2.2-2.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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
function TelegramGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
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
  restart?: boolean;
  pulse?: boolean;
}

function avatarTone(kind: BotState["kind"]): AvatarTone {
  if (kind === "ok") return "warm";
  if (kind === "err") return "alert";
  return "muted";
}

// Health of the agent itself; per-channel state lives in the channel rows.
function resolveState(bot: BotSnapshot): BotState {
  if (bot.status === "provisioning") {
    return { kind: "info", label: "מכין את הסוכן…", pulse: true };
  }
  if (bot.status === "error") {
    return { kind: "err", label: "שגיאה" };
  }
  if (bot.status === "unhealthy") {
    return { kind: "err", label: "הסוכן לא מגיב — אפשר להפעיל מחדש", restart: true, pulse: true };
  }
  if (bot.status === "degraded") {
    return { kind: "warn", label: "חיבור לא יציב — מנסה להתאושש", pulse: true };
  }
  const whatsappConnected = bot.pairingStatus === "paired" && bot.hasWhatsappCreds;
  const telegramConnected = Boolean(bot.telegram?.linked);
  if (whatsappConnected && bot.lastSeenAt === null) {
    return { kind: "info", label: "מתחבר ל-WhatsApp… (עד 2 דקות)", pulse: true };
  }
  if (whatsappConnected || telegramConnected) {
    return { kind: "ok", label: "מחובר ופעיל" };
  }
  if (bot.pairingStatus === "awaiting_qr" || bot.pairingStatus === "awaiting_code") {
    return { kind: "warn", label: "ממתין להתאמה" };
  }
  return { kind: "info", label: "מוכן לחיבור" };
}
