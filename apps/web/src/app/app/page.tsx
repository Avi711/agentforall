import type { Metadata } from "next";
import { Suspense } from "react";
import { requireSession } from "@/lib/auth/session";
import { botService } from "@/lib/bots/service";
import { CreateBotForm } from "./CreateBotForm";
import { BotCard } from "./BotCard";
import { toBotSnapshot } from "@/lib/bots/snapshot";
import { PairedToast } from "./PairedToast";
import { OrnamentDivider, SECTION_LABEL } from "./Marks";
import { SubscribeCard } from "./SubscribeCard";
import { getBillingService } from "@/lib/billing";
import { formatCredits } from "@/lib/billing/format";
import { TRIAL_CREDITS, TRIAL_DAYS } from "@/lib/billing/pricing";
import { toBillingUser } from "@/lib/billing/user";

export const metadata: Metadata = {
  title: "הבית שלי — Agent For All",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AppHome() {
  const session = await requireSession("/login");
  const firstName = session.user.name?.split(" ")[0] ?? "";
  const bot = await botService.findActiveBot(session.user.id);
  const billing = await getBillingService().refreshStatus(toBillingUser(session.user));

  return (
    <div className="relative">
      <Watermark />
      <div className="relative max-w-3xl mx-auto px-4 sm:px-6 pt-10 sm:pt-14 pb-28">
        <Suspense fallback={null}>
          <PairedToast />
        </Suspense>

        <header className="mb-10">
          <p className={`${SECTION_LABEL} mb-3`}>הבית שלי</p>
          <h1 className="font-display text-4xl sm:text-5xl text-espresso leading-tight">
            {firstName ? `שלום ${firstName}` : "ברוכים הבאים"}
          </h1>
          <div className="mt-5 flex items-center gap-4">
            <OrnamentDivider />
            <p className="text-espresso-light text-sm leading-relaxed">הסוכן האישי שלכם, כאן בשקט.</p>
          </div>
        </header>

        {bot ? (
          <BotCard bot={toBotSnapshot(bot)} credits={billing.credits} />
        ) : !billing.entitled ? (
          <SubscribeCard status={billing} />
        ) : (
          <>
            {billing.reason === "trial_available" ? <TrialNotice /> : null}
            <CreateBotForm />
          </>
        )}
      </div>
    </div>
  );
}

function TrialNotice() {
  return (
    <p className="mb-5 text-sm text-espresso bg-cream-dark/60 border border-sand-light rounded-lg p-4 leading-relaxed">
      הסוכן הראשון שלכם מגיע עם {formatCredits(TRIAL_CREDITS)} קרדיטים לניסיון ל-{TRIAL_DAYS} ימים, בלי כרטיס אשראי.
    </p>
  );
}

function Watermark() {
  return (
    <span
      aria-hidden="true"
      className="absolute pointer-events-none select-none top-2 end-0 sm:end-12 font-display text-[9rem] sm:text-[20rem] leading-none text-espresso/[0.03]"
    >
      א
    </span>
  );
}
