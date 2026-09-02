import { randomBytes } from "node:crypto";
import type { IntegrationsBinding } from "../../domain/types.js";

// What a container needs to reach the orchestrator's MCP relay for one bot. Minted locally; the
// provider is not involved until the bot first calls the tool.
export function relayBindingFor(instanceId: string, orchestratorInternalUrl: string): IntegrationsBinding {
  return {
    relayToken: randomBytes(32).toString("hex"),
    relayUrl: new URL(`/api/v1/mcp/${instanceId}`, orchestratorInternalUrl).toString(),
  };
}
