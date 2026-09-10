import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { botService } from "@/lib/bots/service";
import { isWhatsappCloudEnabled, readWhatsappCloudConfig } from "@/lib/whatsapp-cloud/config";
import { WhatsappBusinessConnectFlow } from "./WhatsappBusinessConnectFlow";

export const metadata: Metadata = {
  title: "חיבור WhatsApp Business — Agent For All",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// No consent gate: the official API carries none of the account-suspension risk the pairing flow does.
export default async function WhatsappBusinessConnectPage() {
  const session = await requireSession("/login");
  const bot = await botService.findActiveBot(session.user.id);
  if (!bot) redirect("/app");

  const config = isWhatsappCloudEnabled() ? readWhatsappCloudConfig() : null;
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-8 sm:pt-12 pb-28">
      <WhatsappBusinessConnectFlow
        botId={bot.id}
        meta={config ? { appId: config.appId, configId: config.embeddedSignupConfigId, apiVersion: config.graphApiVersion } : null}
      />
    </div>
  );
}
