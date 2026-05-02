import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { DeleteAccountCard } from "./DeleteAccountCard";
import { OrnamentDivider } from "../Marks";

export const metadata: Metadata = {
  title: "הגדרות — Agent For All",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireSession("/login");

  return (
    <div className="max-w-3xl mx-auto px-6 pt-14 pb-20 space-y-10">
      <header>
        <p className="text-xs uppercase tracking-[0.22em] text-espresso-light/80 mb-3">
          חשבון
        </p>
        <h1 className="font-display text-4xl sm:text-5xl text-espresso leading-tight">הגדרות</h1>
        <div className="mt-5 flex items-center gap-4">
          <OrnamentDivider />
          <p className="text-espresso-light text-sm">ניהול החשבון שלכם.</p>
        </div>
      </header>

      <section className="relative bg-white rounded-[24px] border border-sand-light shadow-[0_1px_0_rgba(44,24,16,0.04),0_24px_60px_-32px_rgba(44,24,16,0.18)] p-8 sm:p-10 overflow-hidden">
        <span aria-hidden className="absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-sand-light to-transparent" />
        <p className="text-[11px] uppercase tracking-[0.22em] text-espresso-light/70 mb-2">
          פרטי חשבון
        </p>
        <h2 className="font-display text-2xl text-espresso mb-6 leading-tight">מי אתם</h2>
        <dl className="divide-y divide-sand-light/70">
          <Row label="שם" value={session.user.name ?? "—"} />
          <Row label="אימייל" value={session.user.email} ltr />
        </dl>
      </section>

      <DeleteAccountCard />
    </div>
  );
}

function Row({ label, value, ltr = false }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex items-baseline gap-4 py-3.5 first:pt-0 last:pb-0">
      <dt className="text-xs uppercase tracking-[0.18em] text-espresso-light/80 w-28">
        {label}
      </dt>
      <dd className="text-espresso text-sm" {...(ltr ? { dir: "ltr" } : {})}>{value}</dd>
    </div>
  );
}
