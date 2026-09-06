"use client";

import Link from "next/link";
import { useState } from "react";
import { LeadsPanel } from "./LeadsPanel";
import { UsersPanel } from "./UsersPanel";
import { BUTTON } from "./ui";

type View = "users" | "leads";

const TABS: { id: View; label: string }[] = [
  { id: "users", label: "Users" },
  { id: "leads", label: "Leads" },
];

export function AdminDashboard({ adminEmail }: { adminEmail: string }) {
  const [view, setView] = useState<View>("users");
  const [reloadToken, setReloadToken] = useState(0);

  return (
    <div dir="ltr" lang="en" className="min-h-screen bg-cream text-left">
      <header className="border-b border-sand-light bg-white px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 py-3">
          <p className="text-base text-espresso">
            <span className="font-bold">Agent</span>
            <span className="text-espresso-light">for</span>
            <span className="font-bold text-terra">All</span>
            <span className="ml-2 text-sm text-espresso-light">Admin</span>
          </p>

          <nav role="tablist" aria-label="Admin sections" className="flex gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={view === tab.id}
                onClick={() => setView(tab.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-espresso focus-visible:ring-offset-2 ${
                  view === tab.id ? "bg-cream-dark text-espresso" : "text-espresso-light hover:text-espresso"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-xs text-espresso-light sm:inline">{adminEmail}</span>
            <button type="button" onClick={() => setReloadToken((t) => t + 1)} className={BUTTON.secondary}>
              Refresh
            </button>
            <Link href="/app" className={BUTTON.quiet}>
              Open app
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        {view === "users" ? <UsersPanel reloadToken={reloadToken} /> : <LeadsPanel reloadToken={reloadToken} />}
      </main>
    </div>
  );
}
