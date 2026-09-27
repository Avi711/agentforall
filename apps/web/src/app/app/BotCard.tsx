"use client";

import { useEffect, useRef, useState } from "react";
import { PendingLink, useNavigate, useRefresh } from "./Pending";
import { DeleteBotDialog } from "./DeleteBotDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { useBotStatus, type BotSnapshot } from "./useBotStatus";
import { BotAvatar, BusyLabel, ChevronEnd, Spinner, SurfaceCard, type AvatarTone } from "./Marks";
import { CreatingPanel } from "./CreatingPanel";
import { buildTimeline } from "@/lib/bots/creation-progress";
import { WhatsAppAccessDialog } from "./WhatsAppAccessSection";
import { OwnerIdentityDialog } from "./OwnerIdentityDialog";
import { CreditsSection } from "./CreditsSection";
import { ChannelsSection, telegramRow, whatsappCloudRow, whatsappRow, type Channel } from "./Channels";
import { TILE_CLASS } from "./action-buttons";
import type { ShowcaseApp } from "@/lib/integrations/catalog.he";
import { WhatsappNumberConfirmDialog } from "./WhatsappNumberDialog";
import type { CreditSummary } from "@/lib/billing/credits/service";
import type { CreditsAction } from "@/lib/billing/service";
import { CreditsActionLink, OUT_OF_CREDITS_LABEL } from "./credits-copy";

export function BotCard({
  bot: initialBot,
  credits,
  creditsAction,
  showCredits,
  apps,
}: {
  bot: BotSnapshot;
  credits: CreditSummary;
  creditsAction: CreditsAction;
  showCredits: boolean;
  apps: readonly ShowcaseApp[];
}) {
  const { refreshing, refresh } = useRefresh();
  const bot = useBotStatus(initialBot);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState<Channel | null>(null);
  const [whatsappConfirm, setWhatsappConfirm] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<"pair" | "telegram" | null>(null);
  const { navigating, navigate } = useNavigate();
  const [cancelPending, setCancelPending] = useState<Channel | null>(null);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [downloadPending, setDownloadPending] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [restartPending, setRestartPending] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const state = resolveState(bot, credits);
  const whatsappConnected = bot.pairingStatus === "paired" && bot.hasWhatsappCreds;

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
    refresh();
  }

  async function disconnectChannel(channel: Channel) {
    const res = await fetch(`/api/bot/${bot.id}/${channel}/disconnect`, {
      method: "POST",
      cache: "no-store",
    });
    if (!res.ok && res.status !== 204) {
      throw new Error(
        res.status === 409
          ? "הסוכן עסוק כרגע — נסו שוב בעוד רגע."
          : channel === "whatsapp"
            ? "ניתוק WhatsApp נכשל"
            : channel === "whatsapp-cloud"
              ? "ניתוק WhatsApp Business נכשל"
              : "ניתוק טלגרם נכשל",
      );
    }
  }

  async function handleDisconnectConfirm() {
    if (!disconnecting) return;
    await disconnectChannel(disconnecting);
    setDisconnecting(null);
    refresh();
  }

  // Cancelling a pairing/link that never completed is low-stakes: no confirm dialog.
  async function handleCancelPending(channel: Channel) {
    if (cancelPending) return;
    setCancelPending(channel);
    setChannelError(null);
    try {
      await disconnectChannel(channel);
      // The menu item stays in "מבטל…" until the refreshed card replaces it.
      refresh(() => setCancelPending(null));
    } catch (err) {
      setChannelError(err instanceof Error ? err.message : "הפעולה נכשלה");
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
        throw new Error("הפעלת הסוכן מחדש נכשלה");
      }
      refresh(() => setRestartPending(false));
    } catch (err) {
      setRestartError(
        err instanceof Error ? err.message : "הפעלת הסוכן מחדש נכשלה",
      );
      setRestartPending(false);
    }
  }

  if (bot.status === "provisioning") {
    return (
      <SurfaceCard className="p-5 sm:p-12">
        <CreatingPanel
          name={bot.displayName}
          restoring={false}
          timeline={buildTimeline({
            // Reload mid-provisioning: the client-side registration already happened, timing unknown.
            local: [{ id: "registering", startedAt: null, endedAt: null }],
            history: bot.provisioningHistory,
            rowKnownAt: null,
            readyAt: null,
          })}
          uploadPercent={null}
          ready={false}
          failure={null}
        />
      </SurfaceCard>
    );
  }

  return (
    <>
      <article
        aria-busy={refreshing || undefined}
        className="relative bg-white rounded-[28px] border border-sand-light shadow-[0_1px_0_rgba(44,24,16,0.04),0_24px_60px_-32px_rgba(44,24,16,0.18)]"
      >
        <span aria-hidden className="absolute top-0 inset-x-12 h-px bg-gradient-to-r from-transparent via-sand-light to-transparent" />
        {downloadPending || refreshing ? (
          <span aria-hidden className="card-progress" />
        ) : null}

        <div className="p-5 sm:p-10 [&>*:last-child]:mb-0">
          {/* Avatar, name and menu stay on one line at every width: wrapping left a hole beside the avatar. */}
          <div className="flex items-start gap-3 sm:gap-5 mb-6 sm:mb-7">
            <BotAvatar
              name={bot.displayName}
              tone={avatarTone(state.kind)}
              pulse={state.pulse ?? false}
              size="lg"
            />

            <div className="min-w-0 flex-1 pt-1 sm:pt-2">
              <h2 className="font-display text-2xl sm:text-3xl text-espresso leading-tight text-balance break-words">
                {bot.displayName}
              </h2>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <StatusBadge kind={state.kind} label={state.label} pulse={state.pulse} />
                <ActivityLine bot={bot} />
              </div>
            </div>

            <div className="relative shrink-0 -me-1.5 -mt-1.5" ref={menuRef}>
              <button
                type="button"
                aria-label="פעולות נוספות על הסוכן"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
                className="w-11 h-11 rounded-full flex items-center justify-center text-espresso-light hover:bg-cream-dark hover:text-espresso focus:outline-none focus-visible:ring-2 focus-visible:ring-terra transition"
              >
                <MoreIcon />
              </button>
              {menuOpen ? (
                <ul className="absolute top-full mt-2 end-0 w-48 origin-top-left animate-popover rounded-xl border border-sand-light bg-white shadow-[0_8px_24px_rgba(44,24,16,0.08)] overflow-hidden z-10">
                  <li>
                    <button
                      type="button"
                      aria-busy={downloadPending}
                      disabled={downloadPending}
                      onClick={() => {
                        setMenuOpen(false);
                        handleExport();
                      }}
                      className="w-full min-h-11 flex items-center gap-3 px-4 py-3 text-sm text-espresso hover:bg-cream-dark focus:outline-none focus-visible:bg-cream-dark focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-terra transition disabled:bg-terra-pale disabled:text-terra"
                    >
                      {downloadPending ? <Spinner /> : <DownloadIcon />}
                      <span>הורדת גיבוי</span>
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setDialogOpen(true);
                      }}
                      className="w-full min-h-11 flex items-center gap-3 px-4 py-3 text-sm text-red-700 hover:bg-red-50 focus:outline-none focus-visible:bg-red-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-700 transition"
                    >
                      <TrashIcon />
                      <span>מחיקת הסוכן</span>
                    </button>
                  </li>
                </ul>
              ) : null}
            </div>
          </div>

          <NextStep bot={bot} state={state} action={creditsAction} />

          {downloadPending ? (
            <div
              role="status"
              aria-live="polite"
              className="mb-6 flex items-center gap-3 rounded-xl border border-terra-light/30 bg-terra-pale/70 px-4 py-3 text-sm text-terra shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]"
            >
              <Spinner />
              <div className="min-w-0">
                <p className="font-medium leading-tight">
                  {"אנחנו מכינים את קבצי הגיבוי של הסוכן."}
                </p>
                <p className="mt-1 text-xs text-espresso-light/75">
                  {"זה לוקח בדרך כלל עד דקה."}
                </p>
              </div>
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
            busy={refreshing}
            onDisconnect={(channel) => setDisconnecting(channel)}
            onCancelPending={handleCancelPending}
            onOpenAccess={() => setAccessOpen(true)}
            onEditOwner={() => setIdentityOpen(true)}
            onConnectWhatsapp={() => setWhatsappConfirm(true)}
          />

          <IntegrationsLink apps={apps} />

          {showCredits ? <CreditsSection credits={credits} action={creditsAction} /> : null}

          {state.restart ? (
            <button
              type="button"
              onClick={handleRestart}
              disabled={restartPending || refreshing}
              aria-busy={restartPending}
              className="inline-flex min-h-11 w-full sm:w-auto items-center justify-center gap-2 px-5 py-3 rounded-xl bg-terra text-white font-medium hover:bg-terra-dark transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:opacity-60"
            >
              <BusyLabel busy={restartPending} busyText="מפעיל מחדש…">הפעלת הסוכן מחדש</BusyLabel>
            </button>
          ) : null}
        </div>
      </article>

      <WhatsappNumberConfirmDialog
        open={whatsappConfirm}
        pending={navigating ? confirmTarget : null}
        onClose={() => setWhatsappConfirm(false)}
        onConfirm={() => {
          setConfirmTarget("pair");
          navigate("/app/bot/pair");
        }}
        onTelegram={
          bot.telegram?.linked
            ? undefined
            : () => {
                setConfirmTarget("telegram");
                navigate("/app/bot/telegram");
              }
        }
      />

      <DeleteBotDialog
        open={dialogOpen}
        botName={bot.displayName}
        onClose={() => setDialogOpen(false)}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={disconnecting !== null}
        title={
          disconnecting === "telegram"
            ? "ניתוק טלגרם"
            : disconnecting === "whatsapp-cloud"
              ? "ניתוק WhatsApp Business"
              : "ניתוק WhatsApp"
        }
        description={
          disconnecting === "whatsapp-cloud" ? (
            <p>
              הסוכן יפסיק לענות ללקוחות במספר העסקי והחיבור ל-Meta יוסר. הזיכרון וההיסטוריה
              נשמרים; אפשר לחבר מחדש בכל רגע דרך Meta.
            </p>
          ) : disconnecting === "telegram" ? (
            <p>
              הסוכן{" "}
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
              הסוכן יפסיק לענות בוואטסאפ והמכשיר המקושר יוסר מהטלפון. הזיכרון, ההיסטוריה
              וההגדרות נשמרים — אפשר לחבר מחדש בכל רגע.
            </p>
          )
        }
        confirmLabel="ניתוק"
        busyLabel="מנתק…"
        onClose={() => setDisconnecting(null)}
        onConfirm={handleDisconnectConfirm}
      />

      {whatsappConnected && bot.whatsappAccess ? (
        <WhatsAppAccessDialog
          open={accessOpen}
          botId={bot.id}
          initial={bot.whatsappAccess}
          ownerNumber={bot.owner.whatsappNumber}
          onClose={() => setAccessOpen(false)}
          onOpenIdentity={() => {
            setAccessOpen(false);
            setIdentityOpen(true);
          }}
        />
      ) : null}

      <OwnerIdentityDialog
        open={identityOpen}
        botId={bot.id}
        initial={bot.owner}
        whatsappAvailable={bot.hasWhatsappChannel}
        onClose={() => setIdentityOpen(false)}
      />
    </>
  );
}

// Fixed timezone and no relative wording: the same string renders on the server and on the client.
const LAST_SEEN_FORMAT = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem",
  day: "numeric",
  month: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function ActivityLine({ bot }: { bot: BotSnapshot }) {
  if (bot.lastSeenAt === null) return null;
  const at = new Date(bot.lastSeenAt);
  if (Number.isNaN(at.getTime())) return null;
  return (
    <p className="text-xs text-espresso-light">
      שיחה אחרונה{" "}
      <time dateTime={bot.lastSeenAt} dir="ltr" className="tabular-nums">
        {LAST_SEEN_FORMAT.format(at)}
      </time>
    </p>
  );
}

// The card is otherwise a status ledger; this answers "what do I do now?" in one line.
function NextStep({ bot, state, action }: { bot: BotSnapshot; state: BotState; action: CreditsAction }) {
  if (state.cause === "credits") {
    return (
      <div className="mb-6 sm:mb-7 rounded-2xl border border-terra/20 bg-terra-pale px-4 py-3.5 sm:px-5">
        <p className="text-sm text-terra-dark leading-relaxed">
          {outOfCreditsStep(bot.displayName, action)}{" "}
          <CreditsActionLink action={action} className="underline font-medium" />
        </p>
      </div>
    );
  }
  const text = nextStep(bot, state);
  if (!text) return null;
  return (
    <div className="mb-6 sm:mb-7 rounded-2xl border border-sand-light bg-cream/70 px-4 py-3.5 sm:px-5">
      <p className="text-sm text-espresso leading-relaxed">{text}</p>
    </div>
  );
}

function outOfCreditsStep(name: string, action: CreditsAction): string {
  if (action === "contact") return `${name} יוכל לענות ברגע שיהיו קרדיטים. התשלומים ייפתחו בקרוב, ובינתיים נסדר את זה יחד.`;
  return `כדי ש${name} יוכל לענות, ${action === "topup" ? "טענו קרדיטים" : "הצטרפו למנוי"}.`;
}

// Text only: choosing or resuming a channel already has its own controls right below.
function nextStep(bot: BotSnapshot, state: BotState): string | null {
  if (state.kind === "err" || bot.status === "degraded" || bot.lastSeenAt !== null) return null;
  const connected = [telegramRow(bot, null), whatsappRow(bot, null), whatsappCloudRow(bot, null)].some((row) => row.connected);
  return connected ? `${bot.displayName} מוכן ומחכה. שלחו הודעה ראשונה, למשל "מה יש לי היום ביומן?".` : null;
}

function IntegrationsLink({ apps }: { apps: readonly ShowcaseApp[] }) {
  return (
    <PendingLink href="/app/bot/connections" className={`${TILE_CLASS} mb-6 sm:mb-7`}>
      <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cream-dark text-espresso">
        <PlugGlyph />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-medium text-espresso">חיבורים לאפליקציות</span>
        <span className="text-[13px] text-espresso-light">כדי שהסוכן יקרא ויפעל בשמכם</span>
        <AppLogos apps={apps} className="mt-2 flex sm:hidden" />
      </span>
      <AppLogos apps={apps} className="hidden sm:flex" />
      <span className="text-espresso-light transition group-hover:text-espresso">
        <ChevronEnd />
      </span>
    </PendingLink>
  );
}

// Each mark tucks under the one before it, so the stack reads right-to-left like the text.
function AppLogos({ apps, className }: { apps: readonly ShowcaseApp[]; className: string }) {
  return (
    <span aria-hidden className={`items-center ${className}`}>
      {apps.map((app, index) => (
        <span key={app.slug} className={`relative flex ${index === 0 ? "" : "-ms-1.5"}`} style={{ zIndex: apps.length - index }}>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white ring-1 ring-sand-light">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={app.logo} alt="" className="h-[18px] w-[18px] object-contain" />
          </span>
        </span>
      ))}
    </span>
  );
}

function PlugGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0V8zM12 16v5" />
    </svg>
  );
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
  cause?: "credits";
}

function avatarTone(kind: BotState["kind"]): AvatarTone {
  if (kind === "ok") return "warm";
  if (kind === "err") return "alert";
  return "muted";
}

// Infrastructure trouble outranks an empty ledger: a bot that is down needs a restart before it needs credits.
function resolveState(bot: BotSnapshot, credits: CreditSummary): BotState {
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
  if (credits.balance.kind === "out") {
    return { kind: "warn", label: `מושהה — ${OUT_OF_CREDITS_LABEL[credits.balance.reason]}`, cause: "credits" };
  }
  const whatsappConnected = bot.pairingStatus === "paired" && bot.hasWhatsappCreds;
  const telegramConnected = Boolean(bot.telegram?.linked);
  if (whatsappConnected && bot.lastSeenAt === null) {
    return { kind: "info", label: "מתחבר לוואטסאפ…", pulse: true };
  }
  // Naming the live channel avoids contradicting a "לא מחובר" row right below.
  if (whatsappConnected && telegramConnected) {
    return { kind: "ok", label: "פעיל בוואטסאפ ובטלגרם" };
  }
  if (telegramConnected) return { kind: "ok", label: "פעיל בטלגרם" };
  if (whatsappConnected) return { kind: "ok", label: "פעיל בוואטסאפ" };
  if (bot.pairingStatus === "awaiting_qr" || bot.pairingStatus === "awaiting_code") {
    return { kind: "warn", label: "ממתין להתאמה" };
  }
  return { kind: "info", label: "מוכן לחיבור" };
}
