import { randomBytes } from "node:crypto";

export const MCP_RELAY_PATH = "/api/v1/mcp";
export const WHATSAPP_CLOUD_RELAY_PATH = "/api/v1/whatsapp-cloud";

export interface RelayUrls {
  mcp: string;
  whatsappCloud: string;
}

// Derived when a bot's config is rendered, never stored: the orchestrator's address can move.
export function relayUrlsFor(instanceId: string, orchestratorInternalUrl: string): RelayUrls {
  const at = (path: string) => new URL(`${path}/${instanceId}`, orchestratorInternalUrl).toString();
  return { mcp: at(MCP_RELAY_PATH), whatsappCloud: at(WHATSAPP_CLOUD_RELAY_PATH) };
}

export function freshRelayToken(): string {
  return randomBytes(32).toString("hex");
}
