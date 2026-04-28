"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ESimCard } from "@/components/ESimCard";
import type {
  PairStatus as CanonicalPairStatus,
  PairQr,
} from "@/lib/orchestrator/types";
import { UNEXPECTED_ERROR_HE } from "@/lib/messages.he";

type Tab = "qr" | "code";

type PairStatus = Pick<
  CanonicalPairStatus,
  | "phase"
  | "pairingStatus"
  | "whatsappAccountId"
  | "qrAvailable"
  | "codeAvailable"
  | "reason"
  | "updatedAt"
>;
type Qr = Pick<PairQr, "dataUrl" | "expiresAt">;

interface Props {
  botId: string;
}

const POLL_MS = 2_000;

export function PairingFlow({ botId }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("qr");
  const [status, setStatus] = useState<PairStatus | null>(null);
  const [qr, setQr] = useState<Qr | null>(null);
  const [phone, setPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [codeBusy, setCodeBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bump to force QR re-fetch on user-triggered refresh.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    abortRef.current = ac;

    async function begin() {
      try {
        const res = await fetch(`/api/bot/${botId}/pair`, {
          method: "POST",
          signal: ac.signal,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(codeToHe(data?.error?.code) ?? "לא הצלחנו להתחיל התאמה");
        }
      } catch (err) {
        if (!cancelled && !isAbort(err)) {
          setError(err instanceof Error ? err.message : UNEXPECTED_ERROR_HE);
        }
      } finally {
        if (!cancelled) setStarting(false);
      }
    }
    void begin();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [botId]);

  useEffect(() => {
    if (starting) return;
    let cancelled = false;
    const ac = new AbortController();

    async function tick() {
      try {
        const res = await fetch(`/api/bot/${botId}/pair/status`, {
          signal: ac.signal,
          cache: "no-store",
        });
        if (res.ok) {
          const payload = (await res.json()) as PairStatus;
          if (!cancelled) setStatus(payload);
          if (payload.phase === "authenticated") {
            router.replace("/app?paired=1");
            return;
          }
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
  }, [botId, router, starting]);

  useEffect(() => {
    if (!status?.qrAvailable) return;
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
  }, [botId, status?.qrAvailable, status?.updatedAt, refreshNonce]);

  // startPairing is idempotent — reuses active session or recreates a missing sidecar.
  async function handleRefresh() {
    setQr(null);
    setError(null);
    try {
      await fetch(`/api/bot/${botId}/pair`, { method: "POST" });
    } catch {
      // Best effort — status polling surfaces any real problem.
    }
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
        body: JSON.stringify({ phone: phone.replace(/[\s-]/g, "") }),
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
    try {
      await fetch(`/api/bot/${botId}/pair`, { method: "DELETE" });
    } catch {
      // best-effort
    }
    router.replace("/app");
  }

  if (starting) {
    return <PhaseCard title="מתחיל התאמה…" body="רגע, מפעיל את חיבור WhatsApp." />;
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
      <div className="bg-white rounded-2xl shadow-sm border border-sand-light p-6 sm:p-8">
        <h1 className="font-display text-2xl text-espresso mb-2">
          חיבור WhatsApp לבוט שלכם
        </h1>
        <p className="text-espresso-light mb-6">
          סרקו את הקוד בטלפון, או בקשו קוד בן 8 תווים אם סריקה לא נוחה.
        </p>

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

        <div className="mt-6 pt-6 border-t border-sand-light flex justify-between items-center">
          <button
            type="button"
            onClick={handleCancel}
            className="text-sm text-espresso-light hover:text-espresso"
          >
            ביטול ההתאמה
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

function TabBar({ value, onChange }: { value: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "qr", label: "סריקה של קוד QR" },
    { id: "code", label: "קוד התאמה של 8 ספרות" },
  ];
  return (
    <div
      role="tablist"
      className="inline-flex rounded-xl bg-cream-dark p-1 gap-1"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
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
    <div className="flex flex-col sm:flex-row gap-8 items-center sm:items-start">
      <div className="flex flex-col items-center gap-3">
        <div className="w-[280px] h-[280px] flex items-center justify-center rounded-2xl border-2 border-dashed border-sand bg-cream-dark">
          {qr ? (
            <img
              src={qr.dataUrl}
              alt="QR להתאמה"
              width={260}
              height={260}
              className="rounded-xl"
            />
          ) : (
            <QrSkeleton phase={phase} />
          )}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="text-sm text-espresso-light hover:text-espresso underline-offset-4 hover:underline"
        >
          רענון הקוד
        </button>
      </div>
      <ol className="flex-1 space-y-2 text-espresso-light text-sm leading-relaxed list-decimal ps-5 marker:text-terra">
        <li>פתחו את WhatsApp בטלפון</li>
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
          className="font-mono text-5xl font-bold tracking-widest text-espresso"
        >
          {pairingCode}
        </p>
        <p className="text-sm text-espresso-light">
          בטלפון: תפריט ⋮ &larr; מכשירים מקושרים &larr; קישור עם מספר טלפון &larr;
          הזינו את הקוד.
        </p>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4 max-w-md">
      <label className="block">
        <span className="block text-sm text-espresso-light mb-1.5">
          מספר הטלפון של WhatsApp (כולל קידומת, ללא +)
        </span>
        <input
          type="tel"
          required
          dir="ltr"
          value={phone}
          onChange={(e) => onPhoneChange(e.target.value)}
          placeholder="972501234567"
          disabled={busy}
          className="w-full px-4 py-3 rounded-xl border border-sand bg-white text-espresso placeholder:text-sand focus:outline-none focus:border-terra focus:ring-2 focus:ring-terra-pale disabled:opacity-50"
        />
      </label>
      {phoneStartsWithZero(phone) ? (
        <p className="text-xs text-espresso-light">
          יש להתחיל בקידומת מדינה (למשל 972 לישראל), לא ב-0.
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy || !isValidPhone(phone)}
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
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-sand-light p-8 text-center space-y-4 max-w-md">
      <h2 className="font-display text-2xl text-espresso">{title}</h2>
      <p className="text-espresso-light">{body}</p>
      {action}
    </div>
  );
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
    default:
      return undefined;
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function isValidPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 && !digits.startsWith("0");
}

function phoneStartsWithZero(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length > 0 && digits.startsWith("0");
}
