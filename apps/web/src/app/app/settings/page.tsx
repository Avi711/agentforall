import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { DeleteAccountCard } from "./DeleteAccountCard";

export const metadata: Metadata = {
  title: "הגדרות — Agent For All",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireSession("/login");

  return (
    <div className="max-w-3xl mx-auto px-6 py-12 space-y-8">
      <header>
        <h1 className="font-display text-4xl text-espresso mb-2">הגדרות</h1>
        <p className="text-espresso-light">ניהול החשבון שלכם</p>
      </header>

      <section className="bg-white rounded-2xl shadow-sm border border-sand-light p-8">
        <h2 className="font-display text-xl text-espresso mb-4">פרטי חשבון</h2>
        <dl className="space-y-3 text-sm">
          <div className="flex gap-3">
            <dt className="text-espresso-light w-32">שם:</dt>
            <dd className="text-espresso">{session.user.name ?? "—"}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="text-espresso-light w-32">אימייל:</dt>
            <dd className="text-espresso" dir="ltr">
              {session.user.email}
            </dd>
          </div>
        </dl>
      </section>

      <DeleteAccountCard />
    </div>
  );
}
