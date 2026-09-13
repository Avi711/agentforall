import { createChannelPluginBase, createChatChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import { dispatchInboundDirectDmWithRuntime } from "openclaw/plugin-sdk/channel-inbound";
import { createWhatsappCloudPlugin } from "./channel-definition.js";

export { CHANNEL_ID, CHANNEL_LABEL, RELAY_TOKEN_ENV, createRelayFor, isConfigured, resolveAccount, setChannelRuntime } from "./channel-definition.js";

export const whatsappCloudPlugin = createWhatsappCloudPlugin({
  createChannelPluginBase,
  createChatChannelPlugin,
  dispatchInboundDirectDm: dispatchInboundDirectDmWithRuntime,
});
