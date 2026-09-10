import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { CHANNEL_LABEL, setChannelRuntime, whatsappCloudPlugin } from "./channel.js";
import { registerWhatsappCloudTools } from "./tools.js";

export default defineChannelPluginEntry({
  id: "agentforall-whatsapp-cloud",
  name: `${CHANNEL_LABEL} (agent-forall)`,
  description: "Customers write to the business number; the bot answers through the orchestrator's Meta Cloud API relay.",
  plugin: whatsappCloudPlugin,
  setRuntime: setChannelRuntime,
  registerFull: registerWhatsappCloudTools,
});
