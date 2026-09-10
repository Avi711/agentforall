import "server-only";
import type { Instance } from "../orchestrator/types";
import type { WhatsappCloudHealth } from "../bots/snapshot";
import { getWhatsappCloudService } from "./service";

// One orchestrator round-trip (cached there for a minute) so the card can show a dead token; best effort.
export async function whatsappCloudHealthOf(userId: string, bot: Instance): Promise<WhatsappCloudHealth | null> {
  if (!bot.config.channels.some((ch) => ch.type === "whatsapp_cloud")) return null;
  try {
    return (await getWhatsappCloudService().status(userId, bot.id)).health;
  } catch {
    return null;
  }
}
