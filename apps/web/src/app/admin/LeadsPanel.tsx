"use client";

import { useCallback, useEffect, useState } from "react";
import { StatCard, Th, formatDateTime } from "./ui";

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
  telegram: { label: "Telegram", tone: "bg-blue-100 text-blue-700" },
  both: { label: "Both", tone: "bg-terra-pale text-terra" },
};

export function LeadsPanel({ reloadToken }: { reloadToken: number }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/leads", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { leads: Lead[] };
      setLeads(data.leads);
    } catch (err) {
      setError(`Failed to load leads (${err instanceof Error ? err.message : "unknown error"})`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  async function deleteLead(id: string) {
    if (!confirm("Delete this lead?")) return;
    setDeleting(id);
    try {
      const res = await fetch("/api/admin/leads", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setLeads((prev) => prev.filter((l) => l.id !== id));
    } catch (err) {
      setError(`Delete failed (${err instanceof Error ? err.message : "unknown error"})`);
    } finally {
      setDeleting(null);
    }
  }

  function exportCSV() {
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
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const platformCounts = leads.reduce<Record<string, number>>((acc, l) => {
    acc[l.platform] = (acc[l.platform] || 0) + 1;
    return acc;
  }, {});
  const todayCount = leads.filter(
    (l) => new Date(l.createdAt).toDateString() === new Date().toDateString(),
  ).length;

  if (loading && leads.length === 0) return <p className="text-espresso-light">Loading…</p>;

  return (
    <>
      {error ? (
        <div role="alert" className="mb-4 flex items-center gap-3 text-sm text-red-600">
          <span>{error}</span>
          <button type="button" onClick={() => void load()} className="underline">
            Retry
          </button>
        </div>
      ) : null}

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total leads" value={String(leads.length)} />
        <StatCard label="Today" value={String(todayCount)} accent />
        <StatCard label="WhatsApp" value={String((platformCounts.whatsapp || 0) + (platformCounts.both || 0))} />
        <StatCard label="Telegram" value={String((platformCounts.telegram || 0) + (platformCounts.both || 0))} />
      </div>

      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={exportCSV}
          disabled={leads.length === 0}
          className="rounded-lg bg-sage px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-sage/80 disabled:opacity-50"
        >
          Export CSV
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-sand/30 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-sand/30 bg-cream/60">
                <Th>#</Th>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Phone</Th>
                <Th>Platform</Th>
                <Th>Interest</Th>
                <Th>Source</Th>
                <Th>Created</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {leads.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-12 text-center text-espresso-light">
                    No leads yet.
                  </td>
                </tr>
              ) : (
                leads.map((lead, i) => {
                  const platform = PLATFORM[lead.platform] ?? {
                    label: lead.platform,
                    tone: "bg-cream-dark text-espresso-light",
                  };
                  return (
                    <tr key={lead.id} className="border-b border-sand/20 transition-colors hover:bg-cream/40">
                      <td className="px-5 py-3.5 text-sm text-espresso-light">{leads.length - i}</td>
                      <td className="px-5 py-3.5 text-sm font-medium text-espresso">{lead.name}</td>
                      <td className="px-5 py-3.5 text-sm text-espresso">{lead.email}</td>
                      <td className="px-5 py-3.5 text-sm text-espresso">{lead.phone || "—"}</td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${platform.tone}`}>
                          {platform.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-espresso-light">{lead.interest || "—"}</td>
                      <td className="px-5 py-3.5 text-sm text-espresso-light">{lead.source || "—"}</td>
                      <td className="px-5 py-3.5 text-sm text-espresso-light">{formatDateTime(lead.createdAt)}</td>
                      <td className="px-5 py-3.5">
                        <button
                          type="button"
                          onClick={() => deleteLead(lead.id)}
                          disabled={deleting === lead.id}
                          className="rounded-lg px-2.5 py-1 text-xs text-red-500 transition-colors hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
                        >
                          {deleting === lead.id ? "…" : "Delete"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
