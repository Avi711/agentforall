import type { Metadata } from "next";
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

  const service = getIntegrationsService();
  let initial: PanelData;
  try {
    const [catalog, connections] = await Promise.all([
      service.catalog(session.user.id),
      service.list(session.user.id, bot.id),
    ]);
    initial = { available: true, catalog, connections };
  } catch (err) {
    if (!isIntegrationsUnavailable(err)) throw err;
    initial = { available: false };
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-8 sm:pt-12 pb-28">
      <ConnectionsPanel botId={bot.id} initial={initial} connectedApp={connectedApp} />
    </div>
  );
}
