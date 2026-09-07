"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ESimCard } from "@/components/ESimCard";
import { isValidIsraeliPhone, normalizeIsraeliPhone, normalizePhoneInput } from "@/lib/phone";
import type {
  PairStatus as CanonicalPairStatus,
  PairQr,
} from "@/lib/orchestrator/types";
import { UNEXPECTED_ERROR_HE } from "@/lib/messages.he";

type Tab = "qr" | "code";
type Step = "number" | "link" | "linking" | "done";

type PairStatus = Pick<
  CanonicalPairStatus,
  | "phase"
  | "pairingStatus"
  | "whatsappAccountId"
  | "qrAvailable"
  | "codeAvailable"
  | "reason"
  | "updatedAt"
  | "ready"
>;
type Qr = Pick<PairQr, "dataUrl" | "expiresAt">;

interface Props {
  botId: string;
  botName: string;
  // The phone the owner writes from, when already on record.
  ownerNumber: string | null;
  // Best guess for the number field (signup form); never trusted without the user confirming it.
  suggestedNumber: string | null;
}

const POLL_MS = 2_000;
// The hello normally lands within seconds; past this the bot is linked either way.
const READY_WAIT_MS = 90_000;

export function PairingFlow({ botId, botName, ownerNumber, suggestedNumber }: Props) {
  const router = useRouter();
  const [owner, setOwner] = useState<string | null>(ownerNumber);
  const [step, setStep] = useState<Step>(ownerNumber ? "link" : "number");
  const [tab, setTab] = useState<Tab>("qr");
  const [status, setStatus] = useState<PairStatus | null>(null);
  const [qr, setQr] = useState<Qr | null>(null);
  const [phone, setPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [helloConfirmed, setHelloConfirmed] = useState(false);
  const [leaving, startLeave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Bump to force QR re-fetch on user-triggered refresh.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const linkingSinceRef = useRef<number | null>(null);

  async function startPairing(number: string, signal?: AbortSignal): Promise<boolean> {
    try {
      const res = await fetch(`/api/bot/${botId}/pair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ownerNumber: number }),
        signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(codeToHe(data?.error?.code) ?? "לא הצלחנו להתחיל התאמה");
      }
      return true;
    } catch (err) {
      if (!isAbort(err)) {
        setError(err instanceof Error ? err.message : UNEXPECTED_ERROR_HE);
      }
      return false;
    }
  }

  // A number already on record skips the question; the pairing starts as soon as the page opens.
  useEffect(() => {
    if (step !== "link" || !owner) return;
    const ac = new AbortController();
    setStarting(true);
    void startPairing(owner, ac.signal).finally(() => {
      if (!ac.signal.aborted) setStarting(false);
    });
    return () => ac.abort();
  }, [botId, owner, step]);

  useEffect(() => {
    if (starting || step === "number" || step === "done") return;
    let cancelled = false;
    const ac = new AbortController();

    async function tick() {
      try {
        const res = await fetch(`/api/bot/${botId}/pair/status`, {
          signal: ac.signal,
          cache: "no-store",
        });
        if (!res.ok) return;
        const payload = (await res.json()) as PairStatus;
        if (cancelled) return;
        setStatus(payload);
        if (payload.phase !== "authenticated") return;
        linkingSinceRef.current ??= Date.now();
        setStep("linking");
        const waitedTooLong = Date.now() - linkingSinceRef.current > READY_WAIT_MS;
        if (payload.ready || waitedTooLong) {
          setHelloConfirmed(Boolean(payload.ready));
          setStep("done");
        }
      } catch (err) {
        if (isAbort(err)) return;
      }
    }

    void tick();
    const interval = setInterval(() => {
      void tick();
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      ac.abort();
    };
  }, [botId, starting, step]);

  useEffect(() => {
    if (!status?.qrAvailable || step !== "link") return;
    let cancelled = false;
    const ac = new AbortController();

    async function loadQr() {
      try {
        const res = await fetch(`/api/bot/${botId}/pair/qr`, {
          signal: ac.signal,
          cache: "no-store",
        });
        if (res.ok) {
          const payload = (await res.json()) as Qr;
          if (!cancelled) setQr(payload);
        }
      } catch (err) {
        if (isAbort(err)) return;
      }
    }
    void loadQr();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [botId, step, status?.qrAvailable, status?.updatedAt, refreshNonce]);

  function handleNumberSubmit(number: string) {
    setError(null);
    setOwner(number);
    setStep("link");
  }

  // startPairing is idempotent — reuses active session or recreates a missing sidecar.
  async function handleRefresh() {
    if (!owner) return;
    setQr(null);
    setError(null);
    await startPairing(owner);
    setRefreshNonce((n) => n + 1);
  }

  async function handleRequestCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setCodeBusy(true);
    try {
      const res = await fetch(`/api/bot/${botId}/pair/code`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: normalizeIsraeliPhone(phone) }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(codeToHe(data?.error?.code) ?? "שגיאה בקבלת קוד");
      }
      setPairingCode(data.code as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : UNEXPECTED_ERROR_HE);
    } finally {
      setCodeBusy(false);
    }
  }

  async function handleCancel() {
    if (cancelBusy) return;
    setCancelBusy(true);
    try {
      await fetch(`/api/bot/${botId}/pair`, { method: "DELETE" });
    } catch {
      // best-effort
    }
    startLeave(() => router.replace("/app"));
  }

  if (step === "number") {
    return (
      <div className="space-y-6">
        <OwnerNumberCard
          botName={botName}
          initial={suggestedNumber}
          error={error}
          onSubmit={handleNumberSubmit}
          onBack={() => startLeave(() => router.replace("/app"))}
        />
        <ESimCard />
      </div>
    );
  }

  if (step === "done") {
    return (
      <DoneCard
        botName={botName}
        botNumber={status?.whatsappAccountId ?? null}
        helloConfirmed={helloConfirmed}
        onDashboard={() => startLeave(() => router.replace("/app"))}
        leaving={leaving}
      />
    );
  }

  if (step === "linking") {
    return (
      <PhaseCard
        title="מחבר את הבוט…"
        body={`עוד רגע ${botName} כותב לכם בוואטסאפ.`}
        spinner
      />
    );
  }

  if (starting) {
    return <PhaseCard title="מתחיל התאמה…" body="רגע, מפעיל את חיבור WhatsApp." spinner />;
  }

  if (status?.phase === "failed" || status?.pairingStatus === "failed") {
    return (
      <PhaseCard
        title="ההתאמה נכשלה"
        body={phaseReasonHe(status?.reason ?? undefined)}
        action={
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 rounded-xl bg-terra text-white font-medium hover:bg-terra-light transition"
          >
            ניסיון נוסף
          </button>
        }
      />
    );
  }

  if (status?.pairingStatus === "expired") {
    return (
      <PhaseCard
        title="פג תוקף"
        body="לא סרקתם את הקוד בזמן. אפשר להתחיל מחדש."
        action={
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 rounded-xl bg-terra text-white font-medium hover:bg-terra-light transition"
          >
            התחלה מחדש
          </button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="relative bg-white rounded-[24px] border border-sand-light shadow-[0_1px_0_rgba(44,24,16,0.04),0_24px_60px_-32px_rgba(44,24,16,0.18)] p-5 sm:p-8 overflow-hidden">
        <span aria-hidden className="absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-sand-light to-transparent" />
        <p className="text-[11px] uppercase tracking-[0.22em] text-terra mb-2">
          חיבור
        </p>
        <h1 className="font-display text-xl sm:text-2xl text-espresso mb-2 leading-tight">
          קחו את הטלפון של הבוט
        </h1>
        <p className="text-espresso-light mb-3 italic">
          סרקו את הקוד מהטלפון של הבוט, או בקשו קוד בן 8 תווים אם סריקה לא נוחה.
        </p>
        <p className="mb-4 text-xs leading-relaxed">
          <strong className="font-bold text-espresso">
            חשוב: אל תחברו את המספר האישי שלכם. וואטסאפ עלולה לחסום מספרים שמריצים בוטים,
            לכן צריך מספר נפרד (eSIM או SIM נוסף).
          </strong>{" "}
          <a
            href="/blog/dedicated-whatsapp-number"
            target="_blank"
            rel="noopener"
            className="font-medium text-terra underline underline-offset-2 hover:text-terra-dark"
          >
            איך משיגים ומגדירים מספר כזה — המדריך המלא
          </a>
        </p>

        {owner ? (
          <p className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-espresso-light">
            <span>
              הבוט יענה לכם מהמספר{" "}
              <span dir="ltr" className="font-medium text-espresso">
                {displayPhone(owner)}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setStep("number")}
              className="text-terra underline underline-offset-4 hover:text-terra-dark"
            >
              שינוי
            </button>
          </p>
        ) : null}

        <TabBar value={tab} onChange={setTab} />

        <div className="mt-6">
          {tab === "qr" ? (
            <QrPanel qr={qr} phase={status?.phase} onRefresh={handleRefresh} />
          ) : (
            <CodePanel
              phone={phone}
              onPhoneChange={setPhone}
              busy={codeBusy}
              pairingCode={pairingCode}
              onSubmit={handleRequestCode}
            />
          )}
        </div>

        {error ? (
          <p className="mt-5 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
            {error}
          </p>
        ) : null}

        <div className="mt-6 pt-4 border-t border-sand-light flex flex-wrap justify-between items-center gap-x-4 gap-y-1">
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelBusy || leaving}
            aria-busy={cancelBusy || leaving}
            className="-mx-2 px-2 py-3 text-sm text-espresso-light hover:text-espresso disabled:opacity-50 disabled:cursor-wait"
          >
            {cancelBusy || leaving ? "מבטלים…" : "ביטול ההתאמה"}
          </button>
          <span className="text-xs text-espresso-light">
            {phaseLabelHe(status?.phase)}
          </span>
        </div>
      </div>

      <ESimCard />

      <Instructions />
    </div>
  );
}

function OwnerNumberCard({
  botName,
  initial,
  error,
  onSubmit,
  onBack,
}: {
  botName: string;
  initial: string | null;
  error: string | null;
  onSubmit: (number: string) => void;
  onBack: () => void;
}) {
  const [value, setValue] = useState(initial ? localInput(initial) : "");
  const [invalid, setInvalid] = useState(false);
  const normalized = normalizePhoneInput(value);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!normalized) {
      setInvalid(true);
      return;
    }
    onSubmit(normalized);
  }

  return (
    <div className="relative bg-white rounded-[24px] border border-sand-light shadow-[0_1px_0_rgba(44,24,16,0.04),0_24px_60px_-32px_rgba(44,24,16,0.18)] p-5 sm:p-8 overflow-hidden">
      <span aria-hidden className="absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-sand-light to-transparent" />
      <p className="text-[11px] uppercase tracking-[0.22em] text-terra mb-2">שלב 1 מתוך 2</p>
      <h1 className="font-display text-xl sm:text-2xl text-espresso mb-2 leading-tight">
        מאיזה מספר תכתבו ל{botName}?
      </h1>
      <p className="text-espresso-light mb-5">
        הוואטסאפ האישי שלכם, זה שבטלפון שביד. לא המספר של הבוט, אותו נחבר בשלב הבא. רק המספר
        הזה יוכל לדבר עם הבוט; כל השאר לא יקבלו תשובה. אפשר להוסיף אנשים אחר כך מהדשבורד.
      </p>

      <TwoPhonesFigure />

      <form onSubmit={submit} className="mt-6 space-y-4 max-w-md">
        <label className="block">
          <span className="block text-sm text-espresso-light mb-1.5">המספר שלכם בוואטסאפ</span>
          <PhoneField
            value={value}
            onChange={(v) => {
              setValue(v);
              setInvalid(false);
            }}
            autoFocus
          />
        </label>
        {invalid ? (
          <p className="text-sm text-red-700">המספר לא נראה תקין. נסו בפורמט 050-1234567.</p>
        ) : null}
        {error ? (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>
        ) : null}
        <button
          type="submit"
          disabled={!normalized}
          className="w-full px-5 py-3 rounded-xl bg-espresso text-cream font-medium hover:bg-espresso-light transition disabled:opacity-50"
        >
          המשך לחיבור הבוט
        </button>
      </form>

      <button
        type="button"
        onClick={onBack}
        className="mt-5 -mx-2 px-2 py-2 text-sm text-espresso-light hover:text-espresso"
      >
        חזרה לדשבורד
      </button>
    </div>
  );
}

// Two phones, so the number question cannot be read as "the bot's number". First card sits on
// the start side in RTL, which is where the eye lands.
function TwoPhonesFigure() {
  return (
    <div className="grid grid-cols-2 gap-3 max-w-md" aria-hidden="true">
      <PhoneCard
        active
        label="הטלפון שלכם"
        caption="המספר הזה"
        glyph={
          <g>
            <path
              d="M11 24h22a5 5 0 0 1 5 5v9a5 5 0 0 1-5 5H20l-6 5v-5h-3a5 5 0 0 1-5-5v-9a5 5 0 0 1 5-5z"
              className="fill-wa-light stroke-wa-dark"
              strokeWidth="1.5"
            />
            <path
              d="M15 34l4 4 9-9"
              className="stroke-wa-dark"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </g>
        }
      />
      <PhoneCard
        label="הטלפון של הבוט"
        caption="סים נפרד · בשלב הבא"
        glyph={
          <g>
            <rect x="10" y="26" width="24" height="18" rx="6" className="fill-cream stroke-sand" strokeWidth="1.5" />
            <circle cx="18" cy="35" r="2.2" className="fill-sand" />
            <circle cx="26" cy="35" r="2.2" className="fill-sand" />
            <path d="M22 20v6" className="stroke-sand" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="22" cy="18.5" r="2" className="fill-sand" />
          </g>
        }
      />
    </div>
  );
}

function PhoneCard({
  active,
  label,
  caption,
  glyph,
}: {
  active?: boolean;
  label: string;
  caption: string;
  glyph: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border px-3 py-3 ${
        active ? "border-terra bg-terra-pale" : "border-sand-light bg-cream-dark"
      }`}
    >
      <svg viewBox="0 0 44 72" width="40" height="66" className="shrink-0">
        <rect
          x="4"
          y="2"
          width="36"
          height="68"
          rx="8"
          className={active ? "fill-white stroke-espresso" : "fill-white stroke-sand"}
          strokeWidth="2"
        />
        <rect x="16" y="6" width="12" height="3" rx="1.5" className={active ? "fill-espresso" : "fill-sand"} />
        <circle cx="22" cy="63" r="2.5" className={active ? "fill-espresso" : "fill-sand"} />
        {glyph}
      </svg>
      <div className="min-w-0">
        <p className={`text-sm font-medium leading-snug ${active ? "text-espresso" : "text-espresso-light"}`}>
          {label}
        </p>
        <p className={`text-xs leading-snug ${active ? "text-terra font-medium" : "text-espresso-light"}`}>
          {caption}
        </p>
      </div>
    </div>
  );
}

function DoneCard({
  botName,
  botNumber,
  helloConfirmed,
  onDashboard,
  leaving,
}: {
  botName: string;
  botNumber: string | null;
  helloConfirmed: boolean;
  onDashboard: () => void;
  leaving: boolean;
}) {
  const chatHref = botNumber
    ? `https://wa.me/${botNumber.replace(/\D/g, "")}?text=${encodeURIComponent("היי")}`
    : null;
  return (
    <div className="bg-white rounded-[24px] shadow-sm border border-sand-light p-6 sm:p-10 text-center space-y-5 max-w-md mx-auto">
      <span
        aria-hidden
        className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-sage-pale text-sage-dark text-2xl"
      >
        ✓
      </span>
      <h2 className="font-display text-2xl text-espresso">{botName} מחובר</h2>
      <p className="text-espresso-light leading-relaxed">
        {helloConfirmed
          ? `${botName} שלח לכם הודעה בוואטסאפ. פתחו את הצ'אט וכתבו לו.`
          : `הבוט מחובר. אם עוד לא הגיעה ממנו הודעה, כתבו לו "היי" והוא יענה.`}
      </p>
      <div className="flex flex-col gap-2">
        {chatHref ? (
          <a
            href={chatHref}
            target="_blank"
            rel="noopener"
            className="inline-flex min-h-12 items-center justify-center rounded-xl bg-terra px-5 py-3 font-medium text-white transition hover:bg-terra-dark"
          >
            פתיחת הצ&apos;אט בוואטסאפ
          </a>
        ) : null}
        <button
          type="button"
          onClick={onDashboard}
          disabled={leaving}
          className="min-h-11 rounded-xl px-5 py-2.5 text-sm font-medium text-espresso-light transition hover:text-espresso disabled:opacity-50"
        >
          לדשבורד
        </button>
      </div>
    </div>
  );
}

function PhoneField({
  value,
  onChange,
  autoFocus,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  return (
    <div dir="ltr" className="flex items-stretch rounded-xl border border-sand bg-white focus-within:border-terra focus-within:ring-2 focus-within:ring-terra-pale">
      <span className="px-3 flex items-center gap-2 border-e border-sand text-espresso-light text-sm select-none">
        <span
          aria-hidden
          className="inline-flex items-center justify-center text-[10px] font-medium tracking-[0.08em] px-1.5 py-0.5 rounded-sm bg-cream-dark text-espresso border border-sand-light"
        >
          IL
        </span>
        <span className="font-mono">+972</span>
      </span>
      <input
        type="tel"
        required
        dir="ltr"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="050-123-4567"
        autoFocus={autoFocus}
        disabled={disabled}
        className="flex-1 px-4 py-3 rounded-xl bg-transparent text-espresso placeholder:text-sand focus:outline-none disabled:opacity-50"
      />
    </div>
  );
}

function TabBar({ value, onChange }: { value: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "qr", label: "סריקה של קוד QR" },
    { id: "code", label: "קוד התאמה של 8 ספרות" },
  ];
  return (
    <div
      role="tablist"
      className="flex w-full sm:inline-flex sm:w-auto rounded-xl bg-cream-dark p-1 gap-1"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`flex-1 sm:flex-none px-3 sm:px-4 py-2.5 rounded-lg text-[13px] sm:text-sm font-medium leading-snug text-center transition ${
            value === t.id
              ? "bg-white text-espresso shadow-sm"
              : "text-espresso-light hover:text-espresso"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function QrPanel({
  qr,
  phase,
  onRefresh,
}: {
  qr: Qr | null;
  phase: PairStatus["phase"] | undefined;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-col sm:flex-row gap-6 sm:gap-8 items-center sm:items-start">
      <div className="flex w-full max-w-[280px] shrink-0 flex-col items-center gap-2 sm:w-[280px]">
        <div className="aspect-square w-full flex items-center justify-center rounded-2xl border-2 border-dashed border-sand bg-cream-dark">
          {qr ? (
            <img
              src={qr.dataUrl}
              alt="QR להתאמה"
              width={260}
              height={260}
              className="h-[93%] w-[93%] rounded-xl object-contain"
            />
          ) : (
            <QrSkeleton phase={phase} />
          )}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="px-3 py-3 text-sm text-espresso-light hover:text-espresso underline-offset-4 hover:underline"
        >
          רענון הקוד
        </button>
      </div>
      <ol className="flex-1 space-y-2 text-espresso-light text-sm leading-relaxed list-decimal ps-5 marker:text-terra">
        <li>פתחו את WhatsApp בטלפון של הבוט</li>
        <li>תפריט ⋮ &larr; מכשירים מקושרים</li>
        <li>לחצו &quot;קישור מכשיר&quot;</li>
        <li>סרקו את הקוד שבמסך</li>
      </ol>
    </div>
  );
}

function QrSkeleton({ phase }: { phase: PairStatus["phase"] | undefined }) {
  const message =
    phase === "authenticating"
      ? "מאמת חיבור…"
      : phase === "awaiting_qr"
      ? "מייצר קוד QR…"
      : "מפעיל את השירות…";

  return (
    <div
      role="status"
      aria-live="polite"
      className="relative w-full h-full flex flex-col items-center justify-center gap-3"
    >
      <CornerMark className="top-3 start-3" />
      <CornerMark className="top-3 end-3 rotate-90" />
      <CornerMark className="bottom-3 start-3 -rotate-90" />
      <span className="inline-block w-10 h-10 rounded-full border-[3px] border-sand border-t-terra animate-spin" />
      <p className="text-espresso-light text-sm">{message}</p>
      <span className="sr-only">טוען</span>
    </div>
  );
}

function CornerMark({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`absolute w-5 h-5 border-t-2 border-s-2 border-sand rounded-tl ${className}`}
    />
  );
}

function CodePanel({
  phone,
  onPhoneChange,
  busy,
  pairingCode,
  onSubmit,
}: {
  phone: string;
  onPhoneChange: (v: string) => void;
  busy: boolean;
  pairingCode: string | null;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
}) {
  if (pairingCode) {
    return (
      <div className="text-center space-y-4">
        <p className="text-espresso-light">הקוד שלכם:</p>
        <p
          dir="ltr"
          className="font-mono text-4xl sm:text-5xl font-bold tracking-[0.15em] sm:tracking-widest text-espresso break-all"
        >
          {pairingCode}
        </p>
        <p className="text-sm text-espresso-light">
          בטלפון של הבוט: תפריט ⋮ &larr; מכשירים מקושרים &larr; קישור עם מספר טלפון &larr;
          הזינו את הקוד.
        </p>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4 max-w-md">
      <label className="block">
        <span className="block text-sm text-espresso-light mb-1.5">
          המספר של הטלפון של הבוט (הסים הנפרד)
        </span>
        <PhoneField value={phone} onChange={onPhoneChange} disabled={busy} />
      </label>
      <button
        type="submit"
        disabled={busy || !isValidIsraeliPhone(phone)}
        className="w-full px-5 py-3 rounded-xl bg-espresso text-cream font-medium hover:bg-espresso-light transition disabled:opacity-50"
      >
        {busy ? "מייצר קוד…" : "קבלת קוד התאמה"}
      </button>
    </form>
  );
}

function Instructions() {
  return (
    <details className="bg-cream-dark rounded-xl p-4">
      <summary className="cursor-pointer font-medium text-espresso">
        לא מצליחים? כמה טיפים
      </summary>
      <ul className="mt-3 space-y-1 text-sm text-espresso-light list-disc ps-5">
        <li>ודאו שגרסת WhatsApp שלכם עדכנית</li>
        <li>אם יש כבר 4 מכשירים מקושרים — הסירו אחד לפני החיבור</li>
        <li>תמיכה: support@agentforall.co.il</li>
      </ul>
    </details>
  );
}

function PhaseCard({
  title,
  body,
  action,
  spinner,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
  spinner?: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-white rounded-2xl shadow-sm border border-sand-light p-6 sm:p-8 text-center space-y-4 max-w-md mx-auto"
    >
      {spinner ? (
        <span className="mx-auto inline-block w-10 h-10 rounded-full border-[3px] border-sand border-t-terra animate-spin" />
      ) : null}
      <h2 className="font-display text-xl sm:text-2xl text-espresso">{title}</h2>
      <p className="text-espresso-light">{body}</p>
      {action}
    </div>
  );
}

// "+972501234567" → "050-123-4567" for the input; other countries keep their international form.
function localInput(e164: string): string {
  const match = /^\+972(\d{2})(\d{3})(\d{4})$/.exec(e164);
  return match ? `0${match[1]}-${match[2]}-${match[3]}` : e164;
}

function displayPhone(e164: string): string {
  return localInput(e164);
}

function phaseLabelHe(phase: PairStatus["phase"] | undefined): string {
  switch (phase) {
    case "awaiting_qr":
      return "מחכה לסריקת הקוד…";
    case "awaiting_code":
      return "מחכה שתזינו את הקוד בטלפון…";
    case "authenticating":
      return "מתחבר ל-WhatsApp…";
    case "authenticated":
      return "מחובר ✓";
    case "failed":
      return "נכשל";
    default:
      return "מתחיל…";
  }
}

function phaseReasonHe(reason: string | undefined): string {
  switch (reason) {
    case "logged_out":
      return "המכשיר נותק על-ידי WhatsApp. נסו מחדש עם מספר אחר.";
    case "connection_replaced":
      return "חיבור מכשיר חדש דרס את הקיים. נסו שוב.";
    case "timed_out":
      return "לקח יותר מדי זמן. נסו שוב.";
    default:
      return reason ?? "משהו השתבש. נסו שוב.";
  }
}

function codeToHe(code: string | undefined): string | undefined {
  switch (code) {
    case "consent_required":
      return "חסר אישור תנאי שירות";
    case "orchestrator_unavailable":
      return "השרת לא זמין כרגע. נסו בעוד רגע.";
    case "conflict":
      return "ההתאמה כבר פעילה או כבר הושלמה.";
    case "too_early":
      return "הקוד עדיין לא מוכן. נסו בעוד שנייה.";
    case "not_found":
      return "הבוט לא נמצא.";
    case "invalid_body":
      return "המספר לא תקין.";
    default:
      return undefined;
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}
