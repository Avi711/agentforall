import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { botService } from "@/lib/bots/service";
import { TelegramConnectFlow } from "./TelegramConnectFlow";

export const metadata: Metadata = {
  title: "חיבור טלגרם — Agent For All",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// No consent gate here: that consent covers the WhatsApp account-suspension risk, which a
// BotFather token does not carry.
export default async function TelegramConnectPage() {
  const session = await requireSession("/login");
  const bot = await botService.findActiveBot(session.user.id);

  if (!bot) {
    redirect("/app");
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-8 sm:pt-12 pb-28">
      <TelegramConnectFlow botId={bot.id} />
    </div>
  );
}
