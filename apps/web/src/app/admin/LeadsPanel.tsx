"use client";

import { useCallback, useEffect, useState } from "react";
import { PLATFORM_LABELS_HE, type Platform } from "@/lib/platforms";

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
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { leads: Lead[] };
      setLeads(data.leads);
    } catch {
      setError("שגיאה בטעינת הלידים");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  async function deleteLead(id: string) {
    if (!confirm("למחוק את הליד הזה?")) return;
    setDeleting(id);
    try {
      const res = await fetch("/api/admin/leads", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setLeads((prev) => prev.filter((l) => l.id !== id));
    } catch {
      setError("שגיאה במחיקה");
    } finally {
      setDeleting(null);
    }
  }

  function exportCSV() {
    const headers = ["שם", "אימייל", "טלפון", "פלטפורמה", "עניין", "מקור", "תאריך"];
    const rows = leads.map((l) => [
      l.name,
      l.email,
      l.phone ?? "",
      l.platform,
      l.interest ?? "",
      l.source ?? "",
      new Date(l.createdAt).toLocaleString("he-IL"),
    ]);
    const escapeCell = (c: string) => {
      let safe = c.replace(/"/g, '""');
      if (/^[=+\-@\t\r]/.test(safe)) safe = `'${safe}`;
      return `"${safe}"`;
    };
    // BOM so Excel opens the Hebrew as UTF-8.
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

  if (loading && leads.length === 0) {
    return <p className="text-espresso-light">טוען…</p>;
  }

  return (
    <>
      {error ? (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label='סה"כ לידים' value={leads.length} />
        <StatCard label="היום" value={todayCount} accent />
        <StatCard
          label="וואטסאפ"
          value={(platformCounts.whatsapp || 0) + (platformCounts.both || 0)}
        />
        <StatCard
          label="טלגרם"
          value={(platformCounts.telegram || 0) + (platformCounts.both || 0)}
        />
      </div>

      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={exportCSV}
          disabled={leads.length === 0}
          className="rounded-lg bg-sage px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-sage/80 disabled:opacity-50"
        >
          ייצוא CSV
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-sand/30 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead>
              <tr className="border-b border-sand/30 bg-cream/60">
                <Th>#</Th>
                <Th>שם</Th>
                <Th>אימייל</Th>
                <Th>טלפון</Th>
                <Th>פלטפורמה</Th>
                <Th>עניין</Th>
                <Th>מקור</Th>
                <Th>תאריך</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {leads.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-12 text-center text-espresso-light">
                    אין לידים עדיין. הם יגיעו בקרוב!
                  </td>
                </tr>
              ) : (
                leads.map((lead, i) => (
                  <tr
                    key={lead.id}
                    className="border-b border-sand/20 transition-colors hover:bg-cream/40"
                  >
                    <td className="px-5 py-3.5 text-sm text-espresso-light">{leads.length - i}</td>
                    <td className="px-5 py-3.5 text-sm font-medium text-espresso">{lead.name}</td>
                    <td className="px-5 py-3.5 text-sm text-espresso" dir="ltr">
                      {lead.email}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-espresso" dir="ltr">
                      {lead.phone || "—"}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${
                          lead.platform === "whatsapp"
                            ? "bg-wa-light text-wa-dark"
                            : lead.platform === "telegram"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-terra-pale text-terra"
                        }`}
                      >
                        {PLATFORM_LABELS_HE[lead.platform as Platform] ?? lead.platform}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-espresso-light">{lead.interest || "—"}</td>
                    <td className="px-5 py-3.5 text-sm text-espresso-light">{lead.source || "—"}</td>
                    <td className="px-5 py-3.5 text-sm text-espresso-light" dir="ltr">
                      {formatDateTime(lead.createdAt)}
                    </td>
                    <td className="px-5 py-3.5">
                      <button
                        type="button"
                        onClick={() => deleteLead(lead.id)}
                        disabled={deleting === lead.id}
                        className="rounded-lg px-2.5 py-1 text-xs text-red-500 transition-colors hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
                      >
                        {deleting === lead.id ? "..." : "מחיקה"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-sand/30 bg-white p-5">
      <p className="text-sm text-espresso-light">{label}</p>
      <p className={`mt-1 text-3xl font-black ${accent ? "text-terra" : "text-espresso"}`}>{value}</p>
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-5 py-3.5 text-sm font-bold text-espresso">{children}</th>;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
