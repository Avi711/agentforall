"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CreditSummary } from "@/lib/billing/credits/service";
import type { AdminBot, AdminOverview, AdminUser } from "@/lib/admin/types";
import { ADMIN_GRANT_MAX_CREDITS, LOW_BALANCE_RATIO, PLANS, TRIAL_CREDITS } from "@/lib/billing/pricing";
import { readApiErrorCode } from "@/lib/http/api-error";
import {
  BUTTON,
  Dot,
  Empty,
  Figure,
  Figures,
  InlineError,
  Meter,
  Panel,
  Pill,
  Th,
  daysUntil,
  formatDate,
  formatDateTime,
  formatTime,
  int,
  usd,
} from "./ui";

const STATUS: Record<string, { label: string; dot: string }> = {
  running: { label: "Running", dot: "bg-sage-dark" },
  degraded: { label: "Degraded", dot: "bg-terra" },
  unhealthy: { label: "Unhealthy", dot: "bg-red-600" },
  provisioning: { label: "Setting up", dot: "bg-sand" },
  stopped: { label: "Stopped", dot: "bg-sand" },
  destroying: { label: "Deleting", dot: "bg-sand" },
  error: { label: "Error", dot: "bg-red-600" },
};

const GRANT_KIND: Record<CreditSummary["grants"][number]["kind"], string> = {
  trial: "Trial",
  plan: "Plan",
  topup: "Top-up",
};

// One trial, one basic month, one standard month.
const GRANT_PRESETS = [TRIAL_CREDITS, PLANS.basic.includedCredits, PLANS.standard.includedCredits];

const GRANT_ERRORS: Record<string, string> = {
  no_ledger: "This user has no credit ledger yet. Credits can only be added on top of a trial or plan.",
  invalid_body: `Enter a whole number between 1 and ${int(ADMIN_GRANT_MAX_CREDITS)}.`,
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: AdminOverview; stale: string | null; refreshing: boolean };

export function UsersPanel({ reloadToken }: { reloadToken: number }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setState((prev) => (prev.kind === "ready" ? { ...prev, refreshing: true, stale: null } : { kind: "loading" }));
    try {
      const res = await fetch("/api/admin/overview", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as AdminOverview;
      setState({ kind: "ready", data, stale: null, refreshing: false });
    } catch (err) {
      const message = `Could not load users (${err instanceof Error ? err.message : "unknown error"}).`;
      setState((prev) =>
        prev.kind === "ready" ? { ...prev, refreshing: false, stale: message } : { kind: "error", message },
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const applyCredits = useCallback((userId: string, credits: CreditSummary) => {
    setState((prev) =>
      prev.kind === "ready"
        ? { ...prev, data: { ...prev.data, users: prev.data.users.map((u) => (u.id === userId ? { ...u, credits } : u)) } }
        : prev,
    );
  }, []);

  const visible = useMemo(() => {
    if (state.kind !== "ready") return [];
    const q = query.trim().toLowerCase();
    if (!q) return state.data.users;
    return state.data.users.filter(
      (u) =>
        (u.name ?? "").toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.bots.some((b) => b.snapshot.displayName.toLowerCase().includes(q)),
    );
  }, [state, query]);

  function toggle(userId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  if (state.kind === "loading") return <p className="text-sm text-espresso-light">Loading users…</p>;
  if (state.kind === "error") return <InlineError onRetry={() => void load()}>{state.message}</InlineError>;

  const { data, stale, refreshing } = state;
  const { totals } = data;
  const outOfCredits = data.users.filter((u) => u.credits !== null && u.credits.available === 0 && u.bots.length > 0).length;
  const attention = outOfCredits + totals.erroredBots;
  const attentionHint = [
    outOfCredits > 0 ? `${outOfCredits} out of credits` : null,
    totals.erroredBots > 0 ? `${totals.erroredBots} bot${totals.erroredBots === 1 ? "" : "s"} in error` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const allOpen = visible.every((u) => expanded.has(u.id));

  return (
    <div className={refreshing ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={refreshing}>
      {stale ? <InlineError onRetry={() => void load()}>{stale} Showing data from {formatTime(data.generatedAt)}.</InlineError> : null}

      <Figures>
        <Figure label="Users" value={int(totals.users)} />
        <Figure
          label="Bots connected"
          value={`${totals.connectedBots} of ${totals.liveBots}`}
          hint={totals.usageUnavailable > 0 ? `${totals.usageUnavailable} without usage data` : undefined}
        />
        <Figure label="Spend this period" value={usd(totals.spendCents)} />
        <Figure
          label="Needs attention"
          value={int(attention)}
          hint={attention > 0 ? attentionHint : "All clear"}
          attention={attention > 0}
        />
      </Figures>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find by name, email, or bot"
          aria-label="Find users"
          className="w-full max-w-xs rounded-lg border border-sand-light bg-white px-3 py-2 text-sm text-espresso placeholder:text-espresso-light/60 focus:border-espresso focus:outline-none"
        />
        <span className="text-xs text-espresso-light">Updated {formatTime(data.generatedAt)}</span>
        <button
          type="button"
          onClick={() => setExpanded(allOpen ? new Set() : new Set(visible.map((u) => u.id)))}
          className={`${BUTTON.quiet} ml-auto`}
          disabled={visible.length === 0}
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>

      <Panel className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem]">
            <thead>
              <tr className="border-b border-sand-light bg-cream/70">
                <Th className="w-[26%]">User</Th>
                <Th className="w-[24%]">Bot</Th>
                <Th className="w-[20%]">Usage</Th>
                <Th>Joined</Th>
                <Th>Last active</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <Empty>{query ? `No users match "${query}".` : "No users yet."}</Empty>
                  </td>
                </tr>
              ) : (
                visible.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    open={expanded.has(user.id)}
                    onToggle={() => toggle(user.id)}
                    onCredits={(credits) => applyCredits(user.id, credits)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function UserRow({
  user,
  open,
  onToggle,
  onCredits,
}: {
  user: AdminUser;
  open: boolean;
  onToggle: () => void;
  onCredits: (credits: CreditSummary) => void;
}) {
  const detailId = `user-${user.id}`;
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-sand-light/70 transition-colors ${open ? "bg-cream/50" : "hover:bg-cream/40"}`}
      >
        <td className="px-4 py-3 align-top">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-espresso">{user.name || "—"}</span>
            {user.betaAccess ? <Pill tone="bg-terra-pale text-terra-dark">Beta</Pill> : null}
          </div>
          <span className="block text-xs text-espresso-light">{user.email}</span>
        </td>
        <td className="px-4 py-3 align-top">
          <BotCell bots={user.bots} />
        </td>
        <td className="px-4 py-3 align-top">
          <UsageCell user={user} />
        </td>
        <td className="px-4 py-3 align-top text-sm text-espresso-light">{formatDate(user.createdAt)}</td>
        <td className="px-4 py-3 align-top text-sm text-espresso-light">{formatDate(user.lastActiveAt)}</td>
        <td className="px-2 py-2 align-top text-right">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            aria-expanded={open}
            aria-controls={detailId}
            aria-label={open ? `Hide details for ${user.email}` : `Show details for ${user.email}`}
            className={`${BUTTON.quiet} px-2`}
          >
            <Chevron open={open} />
          </button>
        </td>
      </tr>
      {open ? (
        <tr id={detailId} className="border-b border-sand-light/70 bg-cream/50">
          <td colSpan={6} className="px-4 pb-5 pt-1">
            <div className="grid gap-4 lg:grid-cols-2">
              <BotDetails bots={user.bots} />
              <CreditDetails user={user} onCredits={onCredits} />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function BotCell({ bots }: { bots: AdminBot[] }) {
  if (bots.length === 0) return <span className="text-sm text-espresso-light">No bot yet</span>;
  return (
    <ul className="space-y-1.5">
      {bots.map((bot) => {
        const status = statusOf(bot);
        return (
          <li key={bot.snapshot.id}>
            <span className="flex items-center gap-2 text-sm text-espresso">
              <Dot className={status.dot} />
              <span className="truncate font-medium">{bot.snapshot.displayName}</span>
              <span className="text-xs text-espresso-light">{status.label}</span>
            </span>
            <span className="block truncate pl-3.5 text-xs text-espresso-light">{channelsOf(bot)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function UsageCell({ user }: { user: AdminUser }) {
  if (user.credits) {
    const c = user.credits;
    const out = c.available === 0;
    return (
      <div>
        <span className={`text-sm tabular-nums ${out ? "font-medium text-terra" : "text-espresso"}`}>
          {out ? "Out of credits" : `${int(c.available)} of ${int(c.allowance)} credits`}
        </span>
        <span className="block text-xs text-espresso-light">{expiryOf(c)}</span>
        <Meter remaining={c.available} total={c.allowance} low={c.lowBalance} label={`${int(c.available)} of ${int(c.allowance)} credits left`} />
      </div>
    );
  }
  if (user.bots.length === 0) return <span className="text-sm text-espresso-light">—</span>;
  const budget = user.maxBudgetCents;
  const reset = user.bots.map((b) => (b.usage?.supported ? b.usage.budgetResetAt : null)).find((r) => r !== null) ?? null;
  const remaining = budget === null ? null : budget - user.spendCents;
  const low = remaining !== null && budget !== null && remaining <= budget * LOW_BALANCE_RATIO;
  return (
    <div>
      <span className={`text-sm tabular-nums ${low ? "font-medium text-terra" : "text-espresso"}`}>
        {usd(user.spendCents)} of {budget === null ? "no cap" : usd(budget)}
      </span>
      <span className="block text-xs text-espresso-light">
        Default budget{reset ? `, resets ${formatDate(reset)}` : ""}
      </span>
      {budget !== null && remaining !== null ? (
        <Meter remaining={remaining} total={budget} low={low} label={`${usd(remaining)} of ${usd(budget)} left`} />
      ) : null}
    </div>
  );
}

function BotDetails({ bots }: { bots: AdminBot[] }) {
  return (
    <section className="rounded-lg border border-sand-light bg-white p-4">
      <h3 className="text-sm font-semibold text-espresso">{bots.length === 1 ? "Bot" : "Bots"}</h3>
      {bots.length === 0 ? (
        <p className="mt-2 text-sm text-espresso-light">This user has not created a bot.</p>
      ) : (
        <ul className="mt-3 divide-y divide-sand-light">
          {bots.map((bot) => (
            <BotFacts key={bot.snapshot.id} bot={bot} />
          ))}
        </ul>
      )}
    </section>
  );
}

function BotFacts({ bot }: { bot: AdminBot }) {
  const s = bot.snapshot;
  const status = statusOf(bot);
  const usage = bot.usage?.supported ? bot.usage : null;
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <Dot className={status.dot} />
        <span className="text-sm font-medium text-espresso">{s.displayName}</span>
        <span className="text-xs text-espresso-light">{status.label}</span>
        <span className="ml-auto select-all font-mono text-[11px] text-espresso-light/70">{s.id}</span>
      </div>
      <dl className="mt-2 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1 text-xs">
        <Fact label="Channels">{channelsOf(bot)}</Fact>
        {s.hasWhatsappChannel ? <Fact label="Owner number">{s.owner.whatsappNumber ?? "not set"}</Fact> : null}
        <Fact label="Model">{bot.model ?? "unknown"}</Fact>
        <Fact label="Runtime">{bot.runtimeKind}</Fact>
        <Fact label="Created">{formatDateTime(bot.createdAt)}</Fact>
        <Fact label="Last seen">{formatDateTime(s.lastSeenAt)}</Fact>
        <Fact label="Gateway key">
          {bot.usage === null
            ? "usage unavailable"
            : usage
              ? `${usd(usage.spendCents)} spent of ${usage.maxBudgetCents === null ? "no cap" : usd(usage.maxBudgetCents)}${usage.budgetResetAt ? `, resets ${formatDate(usage.budgetResetAt)}` : ", no reset"}`
              : "not metered"}
        </Fact>
        {s.status === "error" && bot.errorMessage ? (
          <Fact label="Error">
            <span className="text-red-700">{bot.errorMessage}</span>
          </Fact>
        ) : null}
      </dl>
    </li>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-espresso-light">{label}</dt>
      <dd className="min-w-0 break-words text-espresso">{children}</dd>
    </>
  );
}

function CreditDetails({ user, onCredits }: { user: AdminUser; onCredits: (credits: CreditSummary) => void }) {
  const c = user.credits;
  return (
    <section className="rounded-lg border border-sand-light bg-white p-4">
      <h3 className="text-sm font-semibold text-espresso">Credits</h3>
      {c === null ? (
        <p className="mt-2 text-sm text-espresso-light">
          No credit ledger. {user.bots.length > 0 ? "The bot runs on the gateway's default budget." : "A trial starts with the first bot."}{" "}
          Credits can be added once the user has a trial or plan.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-espresso">
            <span className={`font-medium tabular-nums ${c.available === 0 ? "text-terra" : ""}`}>{int(c.available)}</span>
            <span className="text-espresso-light"> of {int(c.allowance)} left, {int(c.consumed)} used</span>
            {c.unallocated > 0 ? <span className="text-terra"> ({int(c.unallocated)} over)</span> : null}
          </p>
          <p className="text-xs text-espresso-light">
            {expiryOf(c)}
            {c.syncedAt ? `, synced ${formatDateTime(c.syncedAt)}` : ", never synced"}
          </p>
          <ul className="mt-3 divide-y divide-sand-light border-y border-sand-light text-xs">
            {c.grants.map((g) => (
              <li key={g.id} className={`flex items-center gap-3 py-1.5 ${g.live ? "text-espresso" : "text-espresso-light/70"}`}>
                <span className="w-14 font-medium">{GRANT_KIND[g.kind]}</span>
                <span className="tabular-nums">
                  {int(g.credits - g.usedCredits)} of {int(g.credits)} left
                </span>
                <span className="ml-auto">
                  {g.expiresAt ? `${g.live ? "expires" : "expired"} ${formatDate(g.expiresAt)}` : "no expiry"}
                </span>
              </li>
            ))}
          </ul>
          <GrantForm userId={user.id} onGranted={onCredits} />
        </>
      )}
    </section>
  );
}

type GrantState = { kind: "idle" } | { kind: "busy" } | { kind: "error"; message: string } | { kind: "done"; message: string };

function GrantForm({ userId, onGranted }: { userId: string; onGranted: (credits: CreditSummary) => void }) {
  const [amount, setAmount] = useState(String(GRANT_PRESETS[0]));
  const [state, setState] = useState<GrantState>({ kind: "idle" });
  // One key per attempt: a retry after a network error tops up once; a new amount is a new attempt.
  const [ref, setRef] = useState(() => crypto.randomUUID());
  const parsed = Number(amount);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= ADMIN_GRANT_MAX_CREDITS;

  const busy = state.kind === "busy";

  function pick(value: string) {
    setAmount(value);
    setRef(crypto.randomUUID());
    setState({ kind: "idle" });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setState({ kind: "busy" });
    try {
      const res = await fetch("/api/admin/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, credits: parsed, ref }),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const code = readApiErrorCode(payload);
        setState({ kind: "error", message: (code && GRANT_ERRORS[code]) ?? `Could not add credits (HTTP ${res.status}).` });
        return;
      }
      const credits = payload as CreditSummary;
      onGranted(credits);
      setRef(crypto.randomUUID());
      setState(
        credits.stale
          ? { kind: "error", message: `Added ${int(parsed)} credits, but the bot's cap could not be updated. Try again, or wait for the daily sync.` }
          : { kind: "done", message: `Added ${int(parsed)} credits. ${int(credits.available)} now available.` },
      );
    } catch (err) {
      setState({ kind: "error", message: `Could not add credits (${err instanceof Error ? err.message : "network error"}).` });
    }
  }

  return (
    <form onSubmit={submit} className="mt-4">
      <label htmlFor={`grant-${userId}`} className="block text-xs font-medium text-espresso">
        Add credits
      </label>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <input
          id={`grant-${userId}`}
          type="number"
          inputMode="numeric"
          min={1}
          max={ADMIN_GRANT_MAX_CREDITS}
          step={1}
          value={amount}
          disabled={busy}
          onChange={(e) => pick(e.target.value)}
          className="w-28 rounded-lg border border-sand-light px-3 py-2 text-sm tabular-nums text-espresso focus:border-espresso focus:outline-none"
        />
        {GRANT_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => pick(String(preset))}
            disabled={busy}
            aria-pressed={parsed === preset}
            className={`rounded-full border px-2.5 py-1 text-xs tabular-nums transition-colors ${
              parsed === preset ? "border-espresso bg-espresso text-cream" : "border-sand-light text-espresso-light hover:border-sand"
            }`}
          >
            {int(preset)}
          </button>
        ))}
        <button type="submit" disabled={!valid || busy} className={`${BUTTON.primary} ml-auto`}>
          {busy ? "Adding…" : "Add credits"}
        </button>
      </div>
      <p className="mt-1.5 text-xs text-espresso-light">A top-up with no expiry. The bot's cap rises as soon as it is saved.</p>
      {state.kind === "error" ? (
        <p role="alert" className="mt-2 text-xs text-terra-dark">
          {state.message}
        </p>
      ) : null}
      {state.kind === "done" ? (
        <p role="status" className="mt-2 text-xs text-sage-dark">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function statusOf(bot: AdminBot): { label: string; dot: string } {
  return STATUS[bot.snapshot.status] ?? { label: bot.snapshot.status, dot: "bg-sand" };
}

function channelsOf(bot: AdminBot): string {
  const s = bot.snapshot;
  const parts: string[] = [];
  if (s.telegram?.linked) parts.push(s.telegram.botUsername ? `Telegram @${s.telegram.botUsername}` : "Telegram");
  if (s.pairingStatus === "paired" && s.hasWhatsappCreds) {
    const access = s.whatsappAccess ? (s.whatsappAccess.access === "owner" ? ", owner only" : ", open to all") : "";
    parts.push(`WhatsApp${s.whatsappAccountId ? ` +${s.whatsappAccountId}` : ""}${access}`);
  }
  return parts.length > 0 ? parts.join(" and ") : "Not connected";
}

function expiryOf(c: CreditSummary): string {
  if (c.trial.kind === "active") {
    const days = daysUntil(c.trial.expiresAt);
    return `Trial ends ${formatDate(c.trial.expiresAt)}${days > 0 ? ` (${days} day${days === 1 ? "" : "s"})` : ""}`;
  }
  const soonest = c.grants
    .filter((g) => g.live)
    .flatMap((g) => (g.expiresAt === null ? [] : [g.expiresAt]))
    .sort()[0];
  if (soonest) return `Renews or expires ${formatDate(soonest)}`;
  return c.grants.some((g) => g.live) ? "No expiry" : c.trial.kind === "used" ? "Trial ended" : "No credits";
}
