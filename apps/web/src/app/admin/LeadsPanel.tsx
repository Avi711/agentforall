"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BUTTON, Empty, Figure, Figures, InlineError, Panel, Pill, Th, formatDateTime, formatTime, int } from "./ui";

interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  platform: string;
  interest: string | null;
  source: string | null;
  createdAt: string;
}

const PLATFORM: Record<string, { label: string; tone: string }> = {
  whatsapp: { label: "WhatsApp", tone: "bg-wa-light text-wa-dark" },
  telegram: { label: "Telegram", tone: "bg-blue-50 text-blue-700" },
  both: { label: "Both", tone: "bg-terra-pale text-terra-dark" },
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; leads: Lead[]; loadedAt: string; stale: string | null; refreshing: boolean };

export function LeadsPanel({ reloadToken }: { reloadToken: number }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [query, setQuery] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState((prev) => (prev.kind === "ready" ? { ...prev, refreshing: true, stale: null } : { kind: "loading" }));
    try {
      const res = await fetch("/api/admin/leads", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { leads: Lead[] };
      setState({ kind: "ready", leads: data.leads, loadedAt: new Date().toISOString(), stale: null, refreshing: false });
    } catch (err) {
      const message = `Could not load leads (${err instanceof Error ? err.message : "unknown error"}).`;
      setState((prev) =>
        prev.kind === "ready" ? { ...prev, refreshing: false, stale: message } : { kind: "error", message },
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const visible = useMemo(() => {
    if (state.kind !== "ready") return [];
    const q = query.trim().toLowerCase();
    if (!q) return state.leads;
    return state.leads.filter(
      (l) => l.name.toLowerCase().includes(q) || l.email.toLowerCase().includes(q) || (l.phone ?? "").includes(q),
    );
  }, [state, query]);

  async function deleteLead(id: string) {
    setDeleting(id);
    setActionError(null);
    try {
      const res = await fetch("/api/admin/leads", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState((prev) => (prev.kind === "ready" ? { ...prev, leads: prev.leads.filter((l) => l.id !== id) } : prev));
    } catch (err) {
      setActionError(`Could not delete the lead (${err instanceof Error ? err.message : "unknown error"}).`);
    } finally {
      setDeleting(null);
      setConfirming(null);
    }
  }

  function exportCsv(leads: Lead[]) {
    const headers = ["Name", "Email", "Phone", "Platform", "Interest", "Source", "Created"];
    const rows = leads.map((l) => [
      l.name,
      l.email,
      l.phone ?? "",
      l.platform,
      l.interest ?? "",
      l.source ?? "",
      formatDateTime(l.createdAt),
    ]);
    const escapeCell = (c: string) => {
      let safe = c.replace(/"/g, '""');
      if (/^[=+\-@\t\r]/.test(safe)) safe = `'${safe}`;
      return `"${safe}"`;
    };
    // BOM so Excel opens Hebrew names as UTF-8.
    const csv = "\uFEFF" + [headers, ...rows].map((r) => r.map(escapeCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (state.kind === "loading") return <p className="text-sm text-espresso-light">Loading leads…</p>;
  if (state.kind === "error") return <InlineError onRetry={() => void load()}>{state.message}</InlineError>;

  const { leads, stale, refreshing, loadedAt } = state;
  const today = new Date().toDateString();
  const todayCount = leads.filter((l) => new Date(l.createdAt).toDateString() === today).length;
  const count = (platform: string) => leads.filter((l) => l.platform === platform || l.platform === "both").length;

  return (
    <div className={refreshing ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={refreshing}>
      {stale ? <InlineError onRetry={() => void load()}>{stale} Showing data from {formatTime(loadedAt)}.</InlineError> : null}
      {actionError ? <InlineError>{actionError}</InlineError> : null}

      <Figures>
        <Figure label="Leads" value={int(leads.length)} />
        <Figure label="Today" value={int(todayCount)} attention={todayCount > 0} />
        <Figure label="Want WhatsApp" value={int(count("whatsapp"))} />
        <Figure label="Want Telegram" value={int(count("telegram"))} />
      </Figures>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find by name, email, or phone"
          aria-label="Find leads"
          className="w-full max-w-xs rounded-lg border border-sand-light bg-white px-3 py-2 text-sm text-espresso placeholder:text-espresso-light/60 focus:border-espresso focus:outline-none"
        />
        <span className="text-xs text-espresso-light">Updated {formatTime(loadedAt)}</span>
        <button
          type="button"
          onClick={() => exportCsv(visible)}
          disabled={visible.length === 0}
          className={`${BUTTON.secondary} ml-auto`}
        >
          {query ? `Export ${int(visible.length)} as CSV` : "Export CSV"}
        </button>
      </div>

      <Panel className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem]">
            <thead>
              <tr className="border-b border-sand-light bg-cream/70">
                <Th>Lead</Th>
                <Th>Phone</Th>
                <Th>Wants</Th>
                <Th>Interest</Th>
                <Th>Source</Th>
                <Th>Received</Th>
                <Th className="w-40" />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <Empty>{query ? `No leads match "${query}".` : "No leads yet."}</Empty>
                  </td>
                </tr>
              ) : (
                visible.map((lead) => {
                  const platform = PLATFORM[lead.platform] ?? { label: lead.platform, tone: "bg-cream-dark text-espresso-light" };
                  const busy = deleting === lead.id;
                  return (
                    <tr key={lead.id} className="border-b border-sand-light/70 transition-colors hover:bg-cream/40">
                      <td className="px-4 py-3">
                        <span className="block text-sm font-medium text-espresso">{lead.name}</span>
                        <span className="block text-xs text-espresso-light">{lead.email}</span>
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums text-espresso" dir="ltr">
                        {lead.phone || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Pill tone={platform.tone}>{platform.label}</Pill>
                      </td>
                      <td className="max-w-[16rem] px-4 py-3 text-sm text-espresso-light">
                        <span className="line-clamp-2">{lead.interest || "—"}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-espresso-light">{lead.source || "—"}</td>
                      <td className="px-4 py-3 text-sm text-espresso-light">{formatDateTime(lead.createdAt)}</td>
                      <td className="px-2 py-2 text-right">
                        {confirming === lead.id ? (
                          <span className="inline-flex items-center gap-1">
                            <button type="button" onClick={() => void deleteLead(lead.id)} disabled={busy} className={BUTTON.danger}>
                              {busy ? "Deleting…" : "Delete"}
                            </button>
                            <button type="button" onClick={() => setConfirming(null)} disabled={busy} className={BUTTON.quiet}>
                              Keep
                            </button>
                          </span>
                        ) : (
                          <button type="button" onClick={() => setConfirming(lead.id)} className={BUTTON.quiet}>
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
