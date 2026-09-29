import { z } from "zod";
import type { WhatsappLinkState } from "../types.js";
import type { GatewayCall, GatewayCallResult } from "./gateway-call.js";

// Unfiltered: asking for an unregistered channel errors, while the full listing simply omits it.
export const CHANNELS_STATUS_CALL: GatewayCall = { method: "channels.status", params: {}, scopes: ["operator.read"] };

const statusSchema = z.object({ channelAccounts: z.record(z.string(), z.unknown()) });
const accountSchema = z.object({ linked: z.boolean().optional(), connected: z.boolean().optional() }).nullable();

// A broken probe is never "disconnected"; an absent account is, since the gateway dropped the channel.
export function whatsappLinkStateOf(result: GatewayCallResult, channel: string): WhatsappLinkState {
  if (result.status !== "ok") return "probe_failed";

  const parsed = accountSchema.safeParse(firstAccount(result.payload, channel));
  if (!parsed.success) return "protocol_error";

  const account = parsed.data;
  if (!account) return "disconnected";
  if (account.linked === false) return "disconnected";
  if (account.connected === true) return "connected";
  if (account.connected === false) return "disconnected";
  return "unknown";
}

function firstAccount(payload: unknown, channel: string): unknown {
  const status = statusSchema.safeParse(payload);
  const accounts = status.success ? status.data.channelAccounts[channel] : undefined;
  return Array.isArray(accounts) ? (accounts[0] ?? null) : null;
}
