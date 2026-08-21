"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdminBot, AdminOverview, AdminUser } from "@/lib/admin/types";
import { StatCard, Th, formatDate, formatDateTime, formatTime, usd } from "./ui";

const STATUS: Record<string, { label: string; tone: string; dot: string }> = {
  running: { label: "Running", tone: "bg-sage-pale/70 text-sage-dark", dot: "bg-sage-dark" },
  degraded: { label: "Degraded", tone: "bg-terra-pale/70 text-terra", dot: "bg-terra" },
  unhealthy: { label: "Unhealthy", tone: "bg-red-50 text-red-700", dot: "bg-red-600" },
  provisioning: { label: "Provisioning", tone: "bg-cream-dark text-espresso-light", dot: "bg-sand" },
  stopped: { label: "Stopped", tone: "bg-cream-dark text-espresso-light", dot: "bg-sand" },
  destroying: { label: "Deleting…", tone: "bg-cream-dark text-espresso-light", dot: "bg-sand" },
  error: { label: "Error", tone: "bg-red-50 text-red-700", dot: "bg-red-600" },
};

const RUNTIME: Record<string, { label: string; tone: string }> = {
  openclaw: { label: "OpenClaw", tone: "bg-blue-50 text-blue-700" },
  hermes: { label: "Hermes", tone: "bg-purple-50 text-purple-700" },
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: AdminOverview; stale: string | null; refreshing: boolean };

export function UsersPanel({ reloadToken }: { reloadToken: number }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    setState((prev) => (prev.kind === "ready" ? { ...prev, refreshing: true, stale: null } : { kind: "loading" }));
    try {
      const res = await fetch("/api/admin/overview", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as AdminOverview;
      setState({ kind: "ready", data, stale: null, refreshing: false });
    } catch (err) {
      const message = `Failed to load overview (${err instanceof Error ? err.message : "unknown error"})`;
      setState((prev) =>
        prev.kind === "ready" ? { ...prev, refreshing: false, stale: message } : { kind: "error", message },
      );
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

  if (state.kind === "loading") return <p className="text-espresso-light">Loading…</p>;
  if (state.kind === "error") {
    return (
      <div role="alert" className="flex items-center gap-3 text-sm text-red-600">
        <span>{state.message}</span>
        <button type="button" onClick={() => void load()} className="underline">
          Retry
        </button>
      </div>
    );
  }

  const { data, stale, refreshing } = state;
  const { totals } = data;
  const allExpanded = data.users.every((u) => u.bots.length === 0 || expanded.has(u.id));

  return (
    <div className={refreshing ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={refreshing}>
      {stale ? (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {stale} — showing data from {formatTime(data.generatedAt)}.
        </p>
      ) : null}

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Users" value={String(totals.users)} />
        <StatCard
          label="Bots (connected / live)"
          value={`${totals.connectedBots} / ${totals.liveBots}`}
          hint={totals.erroredBots > 0 ? `${totals.erroredBots} in error (hidden from users)` : undefined}
        />
        <StatCard label="Spend (current period)" value={usd(totals.spendCents)} accent />
        <StatCard
          label="Updated"
          value={formatTime(data.generatedAt)}
          hint={totals.usageUnavailable > 0 ? `${totals.usageUnavailable} bots without usage data` : undefined}
        />
      </div>

      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={() =>
            setExpanded(allExpanded ? new Set() : new Set(data.users.filter((u) => u.bots.length > 0).map((u) => u.id)))
          }
          className="text-sm text-espresso-light underline-offset-2 hover:underline"
        >
          {allExpanded ? "Collapse all" : "Expand all"}
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-sand/30 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-sand/30 bg-cream/60">
                <Th>#</Th>
                <Th>User</Th>
                <Th>Joined</Th>
                <Th>Last active</Th>
                <Th>Bots</Th>
                <Th align="right">Spend / budget</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-espresso-light">
                    No users yet.
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
    </div>
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
  const errored = user.bots.filter((b) => b.snapshot.status === "error").length;
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
              <span className="rounded-full bg-terra-pale px-2 py-0.5 text-[10px] font-bold text-terra">BETA</span>
            ) : null}
          </div>
          <span className="block text-xs text-espresso-light">{user.email}</span>
        </td>
        <td className="px-5 py-3.5 text-sm text-espresso-light">{formatDate(user.createdAt)}</td>
        <td className="px-5 py-3.5 text-sm text-espresso-light">{formatDate(user.lastActiveAt)}</td>
        <td className="px-5 py-3.5 text-sm text-espresso">
          {hasBots ? (
            <span className="inline-flex items-center gap-2">
              <span>{user.bots.length - errored}</span>
              {errored > 0 ? <span className="text-xs text-red-600">+{errored} error</span> : null}
              <span className="inline-flex gap-1" aria-hidden>
                {user.bots.map((bot) => (
                  <span
                    key={bot.snapshot.id}
                    title={`${bot.snapshot.displayName} — ${statusOf(bot).label}`}
                    className={`inline-block h-2 w-2 rounded-full ${statusOf(bot).dot}`}
                  />
                ))}
              </span>
            </span>
          ) : (
            <span className="text-espresso-light">—</span>
          )}
        </td>
        <td className="px-5 py-3.5 text-right text-sm tabular-nums text-espresso">
          {hasBots ? `${usd(user.spendCents)} / ${user.maxBudgetCents === null ? "∞" : usd(user.maxBudgetCents)}` : "—"}
        </td>
        <td className="px-5 py-3.5 text-espresso-light">{hasBots ? <span aria-hidden>{open ? "▴" : "▾"}</span> : null}</td>
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
  const runtime = RUNTIME[bot.runtimeKind] ?? { label: bot.runtimeKind, tone: "bg-cream-dark text-espresso-light" };
  const whatsappConnected = s.pairingStatus === "paired" && s.hasWhatsappCreds;
  const telegramConnected = Boolean(s.telegram?.linked);
  return (
    <li className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[minmax(12rem,1.3fr)_1.7fr_1fr_1fr] sm:items-start">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-espresso">{s.displayName}</span>
          <Badge tone={status.tone}>{status.label}</Badge>
          <Badge tone={runtime.tone}>{runtime.label}</Badge>
        </div>
        <div className="mt-0.5 text-xs text-espresso-light">
          {bot.model ?? "model unknown"}
          <span className="ml-2 select-all font-mono text-[11px] opacity-70">{s.id.slice(0, 8)}</span>
        </div>
      </div>

      <div className="text-espresso-light">
        {telegramConnected ? (
          <span>Telegram {s.telegram?.botUsername ? `@${s.telegram.botUsername}` : "(linked)"}</span>
        ) : null}
        {telegramConnected && whatsappConnected ? " · " : null}
        {whatsappConnected ? (
          <span>
            WhatsApp {s.whatsappAccountId ? `+${s.whatsappAccountId}` : ""}
            {s.whatsappAccess ? ` · ${s.whatsappAccess.access === "owner" ? "owner only" : "open to all"}` : ""}
          </span>
        ) : null}
        {!telegramConnected && !whatsappConnected ? "Not connected" : null}
        {s.hasWhatsappChannel ? (
          <span className="block text-xs">Owner number: {s.owner.whatsappNumber ?? "not set"}</span>
        ) : null}
        {s.status === "error" && bot.errorMessage ? (
          <span className="block max-w-prose truncate text-xs text-red-600" title={bot.errorMessage}>
            {bot.errorMessage}
          </span>
        ) : null}
      </div>

      <div className="text-xs text-espresso-light">
        <span className="block">created {formatDate(bot.createdAt)}</span>
        {s.lastSeenAt ? <span className="block">seen {formatDateTime(s.lastSeenAt)}</span> : null}
      </div>

      <div className="text-sm tabular-nums text-espresso sm:text-right">
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

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${tone}`}>{children}</span>;
}

function statusOf(bot: AdminBot): { label: string; tone: string; dot: string } {
  return STATUS[bot.snapshot.status] ?? { label: bot.snapshot.status, tone: "bg-cream-dark text-espresso-light", dot: "bg-sand" };
}
