import type { Metadata } from "next";
import { Suspense } from "react";
import { requireSession } from "@/lib/auth/session";
import { getOrchestratorClient } from "@/lib/orchestrator/client";
import { CreateBotForm } from "./CreateBotForm";
import { BotCard } from "./BotCard";
import { PairedToast } from "./PairedToast";
import { OrnamentDivider } from "./Marks";

export const metadata: Metadata = {
  title: "הבית שלי — Agent For All",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AppHome() {
  const session = await requireSession("/login");
  const firstName = session.user.name?.split(" ")[0] ?? "";
  const bot = await getOrchestratorClient().findActiveBot(session.user.id);

  return (
    <div className="relative">
      <Watermark />
      <div className="relative max-w-3xl mx-auto px-6 pt-14 pb-20">
        <Suspense fallback={null}>
          <PairedToast />
        </Suspense>

        <header className="mb-10">
          <p className="text-xs uppercase tracking-[0.22em] text-espresso-light/80 mb-3">
            הבית שלי
          </p>
          <h1 className="font-display text-4xl sm:text-5xl text-espresso leading-tight">
            {firstName ? `שלום ${firstName}` : "ברוכים הבאים"}
          </h1>
          <div className="mt-5 flex items-center gap-4">
            <OrnamentDivider />
            <p className="text-espresso-light text-sm leading-relaxed">
              הסוכן האישי שלכם, כאן בשקט.
            </p>
          </div>
        </header>

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
          <EmptyState />
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <section className="relative bg-white rounded-[28px] border border-sand-light p-10 sm:p-12 shadow-[0_1px_0_rgba(44,24,16,0.04),0_24px_60px_-32px_rgba(44,24,16,0.18)]">
      <div className="absolute top-0 inset-x-12 h-px bg-gradient-to-r from-transparent via-sand-light to-transparent" />
      <p className="text-xs uppercase tracking-[0.22em] text-terra mb-3">
        התחלה
      </p>
      <h2 className="font-display text-3xl text-espresso mb-3 leading-tight">
        בואו ניצור לכם סוכן
      </h2>
      <p className="text-espresso-light max-w-md mb-8 leading-relaxed">
        תוך דקות יהיה לכם עוזר אישי בוואטסאפ — שמכיר אתכם, זוכר את התזכורות,
        ומגיב 24/7.
      </p>
      <CreateBotForm />
    </section>
  );
}

function Watermark() {
  return (
    <span
      aria-hidden="true"
      className="absolute pointer-events-none select-none top-2 -end-4 sm:end-12 font-display text-[14rem] sm:text-[20rem] leading-none text-espresso/[0.03]"
    >
      א
    </span>
  );
}
