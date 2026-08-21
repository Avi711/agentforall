"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdminBot, AdminOverview, AdminUser } from "@/lib/admin/types";

const STATUS: Record<string, { label: string; tone: string }> = {
  running: { label: "פעיל", tone: "bg-sage-pale/70 text-sage-dark" },
  degraded: { label: "לא יציב", tone: "bg-terra-pale/70 text-terra" },
  unhealthy: { label: "לא מגיב", tone: "bg-red-50 text-red-700" },
  provisioning: { label: "בהקמה", tone: "bg-cream-dark text-espresso-light" },
  stopped: { label: "מושבת", tone: "bg-cream-dark text-espresso-light" },
  destroying: { label: "נמחק…", tone: "bg-cream-dark text-espresso-light" },
  error: { label: "שגיאה", tone: "bg-red-50 text-red-700" },
};

export function UsersPanel({ reloadToken }: { reloadToken: number }) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/overview", { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setData((await res.json()) as AdminOverview);
    } catch {
      setError("שגיאה בטעינת הנתונים");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  function toggle(userId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  if (loading && !data) return <p className="text-espresso-light">טוען…</p>;
  if (!data) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error ?? "שגיאה בטעינת הנתונים"}
      </p>
    );
  }

  const { totals } = data;
  return (
    <>
      {error ? (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="משתמשים" value={String(totals.users)} />
        <StatCard label="בוטים (מחוברים / סה״כ)" value={`${totals.connectedBots} / ${totals.bots}`} />
        <StatCard label="הוצאה בתקופה הנוכחית" value={usd(totals.spendCents)} accent />
        <StatCard
          label="עודכן"
          value={formatTime(data.generatedAt)}
          hint={totals.usageUnavailable > 0 ? `${totals.usageUnavailable} בוטים ללא נתוני שימוש` : undefined}
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-sand/30 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead>
              <tr className="border-b border-sand/30 bg-cream/60">
                <Th>#</Th>
                <Th>משתמש</Th>
                <Th>הצטרף</Th>
                <Th>פעיל לאחרונה</Th>
                <Th>בוטים</Th>
                <Th>הוצאה / תקציב</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-espresso-light">
                    אין משתמשים עדיין.
                  </td>
                </tr>
              ) : (
                data.users.map((user, i) => (
                  <UserRows
                    key={user.id}
                    index={data.users.length - i}
                    user={user}
                    open={expanded.has(user.id)}
                    onToggle={() => toggle(user.id)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function UserRows({
  index,
  user,
  open,
  onToggle,
}: {
  index: number;
  user: AdminUser;
  open: boolean;
  onToggle: () => void;
}) {
  const hasBots = user.bots.length > 0;
  return (
    <>
      <tr
        className={`border-b border-sand/20 transition-colors ${hasBots ? "cursor-pointer hover:bg-cream/40" : ""}`}
        onClick={hasBots ? onToggle : undefined}
        aria-expanded={hasBots ? open : undefined}
      >
        <td className="px-5 py-3.5 text-sm text-espresso-light">{index}</td>
        <td className="px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-espresso">{user.name || "—"}</span>
            {user.betaAccess ? (
              <span className="rounded-full bg-terra-pale px-2 py-0.5 text-[10px] font-bold text-terra">בטא</span>
            ) : null}
          </div>
          <span dir="ltr" className="block text-xs text-espresso-light">
            {user.email}
          </span>
        </td>
        <td className="px-5 py-3.5 text-sm text-espresso-light" dir="ltr">
          {formatDate(user.createdAt)}
        </td>
        <td className="px-5 py-3.5 text-sm text-espresso-light" dir="ltr">
          {formatDate(user.lastActiveAt)}
        </td>
        <td className="px-5 py-3.5 text-sm text-espresso">
          {hasBots ? (
            <span className="inline-flex items-center gap-2">
              <span>{user.bots.length}</span>
              <span className="inline-flex gap-1" aria-hidden>
                {user.bots.map((bot) => (
                  <span
                    key={bot.snapshot.id}
                    title={statusOf(bot).label}
                    className={`inline-block h-2 w-2 rounded-full ${dotTone(bot.snapshot.status)}`}
                  />
                ))}
              </span>
            </span>
          ) : (
            <span className="text-espresso-light">—</span>
          )}
        </td>
        <td className="px-5 py-3.5 text-sm tabular-nums text-espresso" dir="ltr">
          {hasBots ? `${usd(user.spendCents)} / ${user.maxBudgetCents === null ? "∞" : usd(user.maxBudgetCents)}` : "—"}
        </td>
        <td className="px-5 py-3.5 text-espresso-light">
          {hasBots ? <span aria-hidden>{open ? "▴" : "▾"}</span> : null}
        </td>
      </tr>
      {open && hasBots ? (
        <tr className="border-b border-sand/20 bg-cream/30">
          <td colSpan={7} className="px-5 py-4">
            <ul className="space-y-3">
              {user.bots.map((bot) => (
                <BotLine key={bot.snapshot.id} bot={bot} />
              ))}
            </ul>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function BotLine({ bot }: { bot: AdminBot }) {
  const s = bot.snapshot;
  const status = statusOf(bot);
  const whatsappConnected = s.pairingStatus === "paired" && s.hasWhatsappCreds;
  return (
    <li className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[minmax(10rem,1.2fr)_1.6fr_1fr_1fr] sm:items-center">
      <div className="flex items-center gap-2">
        <span className="font-medium text-espresso">{s.displayName}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${status.tone}`}>{status.label}</span>
      </div>
      <div className="text-espresso-light">
        <span dir="ltr">
          {s.telegram?.linked && s.telegram.botUsername ? `@${s.telegram.botUsername}` : null}
        </span>
        {s.telegram?.linked && whatsappConnected ? " · " : null}
        {whatsappConnected && s.whatsappAccountId ? (
          <span dir="ltr">+{s.whatsappAccountId}</span>
        ) : null}
        {whatsappConnected && s.whatsappAccess ? (
          <span> · {s.whatsappAccess.access === "owner" ? "רק הבעלים" : "פתוח לכולם"}</span>
        ) : null}
        {!s.telegram?.linked && !whatsappConnected ? "לא מחובר" : null}
        {s.hasWhatsappChannel ? (
          <span className="block text-xs">
            בעלים: {s.owner.whatsappNumber ? <span dir="ltr">{s.owner.whatsappNumber}</span> : "לא הוגדר"}
          </span>
        ) : null}
      </div>
      <div className="text-xs text-espresso-light" dir="ltr">
        {s.lastSeenAt ? `seen ${formatDateTime(s.lastSeenAt)}` : `created ${formatDate(bot.createdAt)}`}
      </div>
      <div className="text-sm tabular-nums text-espresso" dir="ltr">
        <UsageCell bot={bot} />
      </div>
    </li>
  );
}

function UsageCell({ bot }: { bot: AdminBot }) {
  if (bot.usage === null) return <span className="text-red-600">usage unavailable</span>;
  if (!bot.usage.supported) return <span className="text-espresso-light">—</span>;
  const u = bot.usage;
  return (
    <span>
      {usd(u.spendCents)} / {u.maxBudgetCents === null ? "∞" : usd(u.maxBudgetCents)}
      {u.budgetResetAt ? (
        <span className="block text-xs text-espresso-light">resets {formatDate(u.budgetResetAt)}</span>
      ) : null}
    </span>
  );
}

function StatCard({ label, value, accent, hint }: { label: string; value: string; accent?: boolean; hint?: string }) {
  return (
    <div className="rounded-2xl border border-sand/30 bg-white p-5">
      <p className="text-sm text-espresso-light">{label}</p>
      <p className={`mt-1 text-3xl font-black ${accent ? "text-terra" : "text-espresso"}`} dir="ltr">
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-terra">{hint}</p> : null}
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-5 py-3.5 text-sm font-bold text-espresso">{children}</th>;
}

function statusOf(bot: AdminBot): { label: string; tone: string } {
  return STATUS[bot.snapshot.status] ?? { label: bot.snapshot.status, tone: "bg-cream-dark text-espresso-light" };
}

function dotTone(status: string): string {
  if (status === "running") return "bg-sage-dark";
  if (status === "degraded") return "bg-terra";
  if (status === "unhealthy" || status === "error") return "bg-red-600";
  return "bg-sand";
}

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const DATE = new Intl.DateTimeFormat("he-IL", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  timeZone: "Asia/Jerusalem",
});
const DATE_TIME = new Intl.DateTimeFormat("he-IL", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Jerusalem",
});
const TIME = new Intl.DateTimeFormat("he-IL", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Jerusalem",
});

function formatDate(iso: string | null): string {
  return iso ? DATE.format(new Date(iso)) : "—";
}
function formatDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}
function formatTime(iso: string): string {
  return TIME.format(new Date(iso));
}
