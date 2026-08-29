import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { PLUGIN_ID, createMediaUnderstandingProvider } from "./provider.js";

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "Agent For All media understanding",
  description: "Transcribes voice notes with the bot's own multimodal model, through LiteLLM.",
  register(api) {
    api.registerMediaUnderstandingProvider(createMediaUnderstandingProvider({ logger: api?.logger }));
  },
});
