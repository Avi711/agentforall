"use client";

import Link from "next/link";
import { useState } from "react";
import { LeadsPanel } from "./LeadsPanel";
import { UsersPanel } from "./UsersPanel";

type View = "users" | "leads";

const TABS: { id: View; label: string }[] = [
  { id: "users", label: "משתמשים" },
  { id: "leads", label: "לידים" },
];

export function AdminDashboard({ adminEmail }: { adminEmail: string }) {
  const [view, setView] = useState<View>("users");
  const [reloadToken, setReloadToken] = useState(0);

  return (
    <div dir="rtl" className="min-h-screen bg-cream" style={{ fontFamily: "Heebo, sans-serif" }}>
      <header className="border-b border-sand/30 bg-white/80 px-6 py-4 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4">
          <h1 className="text-xl font-black text-espresso">
            <span className="font-extrabold">Agent</span>
            <span className="font-normal text-espresso-light">for</span>
            <span className="font-extrabold text-terra">All</span>
            <span className="mr-3 text-sm font-normal text-espresso-light">Admin</span>
          </h1>

          <nav role="tablist" aria-label="אזורי ניהול" className="flex gap-1 rounded-xl bg-cream p-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={view === tab.id}
                onClick={() => setView(tab.id)}
                className={`rounded-lg px-4 py-1.5 text-sm font-bold transition-colors ${
                  view === tab.id
                    ? "bg-espresso text-cream"
                    : "text-espresso-light hover:text-espresso"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="ms-auto flex items-center gap-3">
            <span dir="ltr" className="hidden text-xs text-espresso-light sm:inline">
              {adminEmail}
            </span>
            <button
              type="button"
              onClick={() => setReloadToken((t) => t + 1)}
              className="rounded-lg bg-espresso px-4 py-2 text-sm font-bold text-cream transition-colors hover:bg-terra"
            >
              רענון
            </button>
            <Link
              href="/app"
              className="rounded-lg px-4 py-2 text-sm font-medium text-espresso-light ring-1 ring-sand/50 transition-colors hover:bg-cream"
            >
              לאפליקציה
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {view === "users" ? (
          <UsersPanel reloadToken={reloadToken} />
        ) : (
          <LeadsPanel reloadToken={reloadToken} />
        )}
      </main>
    </div>
  );
}
