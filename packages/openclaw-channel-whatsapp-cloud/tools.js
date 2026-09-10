import { Type } from "./schema.js";
import { CHANNEL_ID, createRelayFor, isConfigured, resolveAccount } from "./channel.js";
import { assertOwnerSession, customerOfSession, waIdOf } from "./session-peer.js";

function text(value) {
  return { content: [{ type: "text", text: value }] };
}

function relayFor(ctx) {
  const cfg = ctx.getRuntimeConfig?.() ?? ctx.runtimeConfig ?? ctx.config;
  const account = resolveAccount(cfg, undefined);
  if (!isConfigured(account)) throw new Error("WhatsApp Business is not connected on this bot");
  return createRelayFor(account);
}

// The orchestrator's per-sender policy decides who sees which of these; a customer session gets only the escalation.
export function registerWhatsappCloudTools(api) {
  api.registerTool((ctx) => [
    {
      name: "whatsapp_cloud_escalate",
      label: "Escalate to the owner",
      description:
        "Hand the current WhatsApp Business conversation to the business owner. Use when the customer asks for something you cannot do or answer. Give a one-paragraph summary of what they need.",
      parameters: Type.Object({
        summary: Type.String({ minLength: 1, maxLength: 2000 }),
      }),
      // The customer is the session's own peer; the model never names one.
      execute: async (_toolCallId, params) => {
        const waId = customerOfSession(ctx.sessionKey);
        if (!waId) throw new Error("this tool only works inside a WhatsApp Business customer conversation");
        const { notified } = await relayFor(ctx).escalate(waId, params.summary);
        return text(
          notified
            ? "The owner was notified and will take it from here."
            : "The owner was already notified about this customer a moment ago; no need to ask again.",
        );
      },
    },
    {
      name: "whatsapp_cloud_handoff",
      label: "Take over or hand back a customer conversation",
      description:
        "Owner only. mode=human: you (the owner) answer this customer yourself and the bot stays silent. mode=bot: the bot answers again. waId is the customer's number in digits, e.g. 972501234567.",
      parameters: Type.Object({
        waId: Type.String({ pattern: "^\\+?\\d{6,20}$" }),
        mode: Type.Union([Type.Literal("human"), Type.Literal("bot")]),
      }),
      execute: async (_toolCallId, params) => {
        assertOwnerSession(ctx.sessionKey);
        const conversation = await relayFor(ctx).setMode(waIdOf(params.waId), params.mode);
        return text(
          conversation.mode === "human"
            ? `You now answer +${conversation.waId} yourself; the bot is silent there.`
            : `The bot answers +${conversation.waId} again.`,
        );
      },
    },
    {
      name: "whatsapp_cloud_reply",
      label: "Reply to a customer on the business number",
      description:
        "Owner only. Send a message to a customer on the WhatsApp Business number. Only works within 24 hours of the customer's last message.",
      parameters: Type.Object({
        waId: Type.String({ pattern: "^\\+?\\d{6,20}$" }),
        text: Type.String({ minLength: 1, maxLength: 4096 }),
      }),
      execute: async (_toolCallId, params) => {
        assertOwnerSession(ctx.sessionKey);
        const wamid = await relayFor(ctx).sendText({ to: waIdOf(params.waId), text: params.text, kind: "owner" });
        return { content: [{ type: "text", text: `Sent to +${waIdOf(params.waId)}.` }], details: { wamid, channel: CHANNEL_ID } };
      },
    },
  ]);
}
