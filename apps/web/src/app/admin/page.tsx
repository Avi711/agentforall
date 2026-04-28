"use client";

import { useState, useCallback } from "react";
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

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Component state only — no persistence; reload requires re-entry.
  const fetchLeads = useCallback(async (pw: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/leads", {
        headers: { Authorization: `Bearer ${pw}` },
      });
      if (res.status === 401) {
        setAuthed(false);
        setError("סיסמה שגויה");
        return;
      }
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setLeads(data.leads);
      setAuthed(true);
    } catch {
      setError("שגיאה בטעינת נתונים");
    } finally {
      setLoading(false);
    }
  }, []);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    fetchLeads(password);
  }

  const [deleting, setDeleting] = useState<string | null>(null);

  async function deleteLead(id: string) {
    if (!confirm("למחוק את הליד הזה?")) return;
    setDeleting(id);
    try {
      const res = await fetch("/api/admin/leads", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${password}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setLeads((prev) => prev.filter((l) => l.id !== id));
      } else {
        alert("שגיאה במחיקה");
      }
    } catch {
      alert("שגיאה במחיקה");
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
    const csv = "\uFEFF" + [headers, ...rows].map((r) => r.map(escapeCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!authed) {
    return (
      <div
        dir="rtl"
        className="flex min-h-screen items-center justify-center bg-cream"
        style={{ fontFamily: "Heebo, sans-serif" }}
      >
        <form
          onSubmit={handleLogin}
          className="w-full max-w-sm rounded-2xl border border-sand/40 bg-white p-8 shadow-xl"
        >
          <h1 className="mb-1 text-2xl font-black text-espresso">Admin Panel</h1>
          <p className="mb-6 text-sm text-espresso-light">Agent For All — ניהול לידים</p>

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="סיסמה"
            className="mb-4 w-full rounded-xl border-0 bg-cream px-4 py-3 text-espresso ring-1 ring-sand/50 focus:ring-2 focus:ring-terra focus:outline-none"
            autoFocus
          />

          {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-espresso px-6 py-3 font-bold text-cream transition-colors hover:bg-terra disabled:opacity-50"
          >
            {loading ? "טוען..." : "כניסה"}
          </button>
        </form>
      </div>
    );
  }

  const platformCounts = leads.reduce(
    (acc, l) => {
      acc[l.platform] = (acc[l.platform] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const todayCount = leads.filter(
    (l) => new Date(l.createdAt).toDateString() === new Date().toDateString()
  ).length;

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-cream"
      style={{ fontFamily: "Heebo, sans-serif" }}
    >
      {/* Header */}
      <header className="border-b border-sand/30 bg-white/80 px-6 py-4 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div>
            <h1 className="text-xl font-black text-espresso">
              <span className="font-extrabold">Agent</span>
              <span className="font-normal text-espresso-light">for</span>
              <span className="font-extrabold text-terra">All</span>
              <span className="mr-3 text-sm font-normal text-espresso-light">Admin</span>
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={exportCSV}
              className="rounded-lg bg-sage px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-sage/80"
            >
              ייצוא CSV
            </button>
            <button
              onClick={() => fetchLeads(password)}
              className="rounded-lg bg-espresso px-4 py-2 text-sm font-bold text-cream transition-colors hover:bg-terra"
            >
              רענון
            </button>
            <button
              onClick={() => {
                setAuthed(false);
                setPassword("");
              }}
              className="rounded-lg px-4 py-2 text-sm font-medium text-espresso-light ring-1 ring-sand/50 transition-colors hover:bg-cream"
            >
              יציאה
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {/* Stats */}
        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-2xl border border-sand/30 bg-white p-5">
            <p className="text-sm text-espresso-light">סה"כ לידים</p>
            <p className="mt-1 text-3xl font-black text-espresso">{leads.length}</p>
          </div>
          <div className="rounded-2xl border border-sand/30 bg-white p-5">
            <p className="text-sm text-espresso-light">היום</p>
            <p className="mt-1 text-3xl font-black text-terra">{todayCount}</p>
          </div>
          <div className="rounded-2xl border border-sand/30 bg-white p-5">
            <p className="text-sm text-espresso-light">וואטסאפ</p>
            <p className="mt-1 text-3xl font-black text-espresso">
              {(platformCounts.whatsapp || 0) + (platformCounts.both || 0)}
            </p>
          </div>
          <div className="rounded-2xl border border-sand/30 bg-white p-5">
            <p className="text-sm text-espresso-light">טלגרם</p>
            <p className="mt-1 text-3xl font-black text-espresso">
              {(platformCounts.telegram || 0) + (platformCounts.both || 0)}
            </p>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-2xl border border-sand/30 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-right">
              <thead>
                <tr className="border-b border-sand/30 bg-cream/60">
                  <th className="px-5 py-3.5 text-sm font-bold text-espresso">#</th>
                  <th className="px-5 py-3.5 text-sm font-bold text-espresso">שם</th>
                  <th className="px-5 py-3.5 text-sm font-bold text-espresso">אימייל</th>
                  <th className="px-5 py-3.5 text-sm font-bold text-espresso">טלפון</th>
                  <th className="px-5 py-3.5 text-sm font-bold text-espresso">פלטפורמה</th>
                  <th className="px-5 py-3.5 text-sm font-bold text-espresso">עניין</th>
                  <th className="px-5 py-3.5 text-sm font-bold text-espresso">מקור</th>
                  <th className="px-5 py-3.5 text-sm font-bold text-espresso">תאריך</th>
                  <th className="px-5 py-3.5 text-sm font-bold text-espresso"></th>
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
                      <td className="px-5 py-3.5 text-sm text-espresso-light">
                        {leads.length - i}
                      </td>
                      <td className="px-5 py-3.5 text-sm font-medium text-espresso">
                        {lead.name}
                      </td>
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
                      <td className="px-5 py-3.5 text-sm text-espresso-light">
                        {lead.interest || "—"}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-espresso-light">
                        {lead.source || "—"}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-espresso-light" dir="ltr">
                        {new Date(lead.createdAt).toLocaleString("he-IL", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-5 py-3.5">
                        <button
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
      </main>
    </div>
  );
}
