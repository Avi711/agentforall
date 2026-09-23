import type { Metadata } from "next";
import { Suspense } from "react";
import { requireSession, type AuthenticatedUser } from "@/lib/auth/session";
import { botService } from "@/lib/bots/service";
import { CreateBotForm } from "./CreateBotForm";
import { BotCard } from "./BotCard";
import { toBotSnapshot } from "@/lib/bots/snapshot";
import { isWhatsappCloudEnabledFor } from "@/lib/whatsapp-cloud/config";
import { whatsappCloudHealthOf } from "@/lib/whatsapp-cloud/health";
import { PairedToast } from "./PairedToast";
import { SubscribeCard } from "./SubscribeCard";
import { getBillingService } from "@/lib/billing";
import { formatCredits } from "@/lib/billing/format";
import { TRIAL_CREDITS, TRIAL_DAYS } from "@/lib/billing/pricing";
import { toBillingUser } from "@/lib/billing/user";
import { BotCardSkeleton } from "./Skeleton";
import { SHOWCASE_APPS } from "@/lib/integrations/catalog.he";
import type { BillingStatus } from "@/lib/billing/service";
import { CreditsActionLink } from "./credits-copy";

export const metadata: Metadata = {
  title: "הבית שלי — Agent For All",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AppHome() {
  const session = await requireSession("/login");
  const firstName = session.user.name?.split(" ")[0] ?? "";

  return (
    <div className="relative">
      <Watermark />
      <div className="relative max-w-3xl mx-auto px-4 sm:px-6 pt-6 sm:pt-10 pb-28">
        <Suspense fallback={null}>
          <PairedToast />
        </Suspense>

        {/* The card is the page; the greeting gets one line so it stays above the fold on a phone. */}
        <h1 className="font-display text-2xl sm:text-3xl text-espresso leading-tight mb-5 sm:mb-6">
          {firstName ? `שלום ${firstName}` : "ברוכים הבאים"}
        </h1>

        <Suspense fallback={<BotCardSkeleton />}>
          <HomeCard user={session.user} />
        </Suspense>
      </div>
    </div>
  );
}

// Streamed so the greeting paints before the orchestrator and billing round-trips finish.
async function HomeCard({ user }: { user: AuthenticatedUser }) {
  const [bot, billing] = await Promise.all([
    botService.findActiveBot(user.id),
    getBillingService().refreshStatus(toBillingUser(user)),
  ]);

  const whatsappCloudEnabled = isWhatsappCloudEnabledFor(user.id);
  if (bot) {
    const whatsappCloudHealth = await whatsappCloudHealthOf(user.id, bot);
    const snapshot = toBotSnapshot(bot, { whatsappCloudHealth, whatsappCloudEnabled });
    return <BotCard bot={snapshot} credits={billing.credits} creditsAction={billing.creditsAction} apps={SHOWCASE_APPS} />;
  }
  if (!billing.entitled) return <SubscribeCard status={billing} />;
  return (
    <>
      {billing.reason === "trial_available" ? <TrialNotice /> : null}
      {billing.reason !== "trial_available" && billing.credits.available === 0 ? <NoCreditsNotice status={billing} /> : null}
      <CreateBotForm whatsappBusiness={whatsappCloudEnabled} />
    </>
  );
}

function TrialNotice() {
  return (
    <p className="mb-5 text-sm text-espresso bg-cream-dark/60 border border-sand-light rounded-lg p-4 leading-relaxed">
      הסוכן הראשון שלכם מגיע עם {formatCredits(TRIAL_CREDITS)} קרדיטים לניסיון ל-{TRIAL_DAYS} ימים, בלי כרטיס אשראי.
    </p>
  );
}

// Entitled without credits (beta, mailbox already had its trial): the bot would be created muted.
function NoCreditsNotice({ status }: { status: BillingStatus }) {
  return (
    <p className="mb-5 text-sm text-terra-dark bg-terra-pale border border-terra/20 rounded-lg p-4 leading-relaxed">
      בחשבון אין קרדיטים כרגע, אז הסוכן לא יענה עד שייטענו. <CreditsActionLink action={status.creditsAction} className="underline font-medium" />
    </p>
  );
}

function Watermark() {
  return (
    <span
      aria-hidden="true"
      className="hidden sm:block absolute pointer-events-none select-none top-2 end-12 font-display text-[20rem] leading-none text-espresso/[0.03]"
    >
      א
    </span>
  );
}
