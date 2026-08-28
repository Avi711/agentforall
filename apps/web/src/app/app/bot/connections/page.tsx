import type { Metadata } from "next";
import { PendingLink } from "@/app/app/Pending";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { botService } from "@/lib/bots/service";
import { getIntegrationsService } from "@/lib/integrations";
import { ConnectedQuerySchema } from "@/lib/integrations/schemas";
import { isIntegrationsUnavailable } from "@/lib/integrations/service";
import { ConnectionsPanel, type PanelData } from "./ConnectionsPanel";

export const metadata: Metadata = {
  title: "חיבורים לאפליקציות — Agent For All",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession("/login");
  const bot = await botService.findActiveBot(session.user.id);
  if (!bot) redirect("/app");

  const params = await searchParams;
  const connectedParam = ConnectedQuerySchema.safeParse(params.connected);
  const connectedApp = connectedParam.success ? (connectedParam.data ?? null) : null;

  let initial: PanelData;
  try {
    initial = { available: true, ...(await getIntegrationsService().overview(session.user.id, bot.id, connectedApp)) };
  } catch (err) {
    if (!isIntegrationsUnavailable(err)) throw err;
    initial = { available: false };
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-4 sm:pt-8 pb-28">
      <PendingLink
        href="/app"
        className="inline-flex min-h-11 items-center gap-1.5 -ms-2 px-2 mb-3 rounded-lg text-sm text-espresso-light hover:text-terra focus:outline-none focus-visible:ring-2 focus-visible:ring-terra transition"
      >
        <BackChevron />
        <span>הבית שלי</span>
      </PendingLink>
      <ConnectionsPanel botId={bot.id} botName={bot.displayName} initial={initial} connectedApp={connectedApp} />
    </div>
  );
}

function BackChevron() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="w-4 h-4 rtl:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M12 5l-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
