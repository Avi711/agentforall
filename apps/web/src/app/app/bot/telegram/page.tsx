import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConsentStatus } from "@/lib/consent/service";
import { botService } from "@/lib/bots/service";
import { ConsentGate } from "../pair/ConsentGate";
import { TelegramConnectFlow } from "./TelegramConnectFlow";

export const metadata: Metadata = {
  title: "חיבור טלגרם — Agent For All",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function TelegramConnectPage() {
  const session = await requireSession("/login");
  const [consent, bot] = await Promise.all([
    getConsentStatus(session.user.id),
    botService.findActiveBot(session.user.id),
  ]);

  if (!bot) {
    redirect("/app");
  }

  const needsConsent = !consent.accepted || consent.stale;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-8 sm:pt-12 pb-28">
      {needsConsent ? <ConsentGate /> : <TelegramConnectFlow botId={bot.id} />}
    </div>
  );
}
