import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConsentStatus } from "@/lib/consent/service";
import { getOrchestratorClient } from "@/lib/orchestrator/client";
import { ConsentGate } from "./ConsentGate";
import { PairingFlow } from "./PairingFlow";

export const metadata: Metadata = {
  title: "חיבור WhatsApp — Agent For All",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function PairPage() {
  const session = await requireSession("/login");
  const [consent, bots] = await Promise.all([
    getConsentStatus(session.user.id),
    getOrchestratorClient().listBots(session.user.id),
  ]);

  const bot = bots.find(
    (b) => b.status !== "destroyed" && b.status !== "error",
  );

  if (!bot) {
    redirect("/app");
  }

  if (bot.pairingStatus === "paired") {
    redirect("/app?paired=1");
  }

  const needsConsent = !consent.accepted || consent.stale;

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      {needsConsent ? <ConsentGate /> : <PairingFlow botId={bot.id} />}
    </div>
  );
}
