import type { Metadata } from "next";
import { Suspense } from "react";
import { requireSession } from "@/lib/auth/session";
import { getOrchestratorClient } from "@/lib/orchestrator/client";
import { CreateBotForm } from "./CreateBotForm";
import { BotCard } from "./BotCard";
import { PairedToast } from "./PairedToast";

export const metadata: Metadata = {
  title: "הבית שלי — Agent For All",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AppHome() {
  const session = await requireSession("/login");
  const firstName = session.user.name?.split(" ")[0] ?? "";
  // Errors bubble up to `app/error.tsx` which shows a friendly retry card.
  const bot = await getOrchestratorClient().findActiveBot(session.user.id);

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <Suspense fallback={null}>
        <PairedToast />
      </Suspense>

      <h1 className="font-display text-4xl text-espresso mb-3">
        {firstName ? `שלום ${firstName}` : "ברוכים הבאים"} 👋
      </h1>
      <p className="text-espresso-light mb-10">
        הסוכן האישי שלכם מחכה להתחיל לעבוד.
      </p>

      {bot ? (
        <BotCard
          bot={{
            id: bot.id,
            displayName: bot.displayName,
            status: bot.status,
            pairingStatus: bot.pairingStatus,
            whatsappAccountId: bot.whatsappAccountId,
            hasWhatsappCreds: bot.hasWhatsappCreds,
            lastSeenAt: bot.lastSeenAt ?? null,
          }}
        />
      ) : (
        <section className="bg-white rounded-2xl shadow-sm border border-sand-light p-8">
          <h2 className="font-display text-2xl text-espresso mb-2">
            בואו ניצור לכם סוכן
          </h2>
          <p className="text-espresso-light mb-6 max-w-md">
            תוך דקות יהיה לכם עוזר אישי בוואטסאפ — שמכיר אתכם, זוכר את התזכורות,
            ומגיב 24/7.
          </p>
          <CreateBotForm />
        </section>
      )}
    </div>
  );
}
