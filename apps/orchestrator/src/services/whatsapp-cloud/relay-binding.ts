import { randomBytes, randomInt } from "node:crypto";

export const WHATSAPP_CLOUD_RELAY_PATH = "/api/v1/whatsapp-cloud";

export interface WhatsappCloudBinding {
  relayToken: string;
  relayUrl: string;
}

// Everything the container needs from us for one business number, minted locally.
export function whatsappCloudBindingFor(instanceId: string, orchestratorInternalUrl: string): WhatsappCloudBinding {
  return {
    relayToken: randomBytes(32).toString("hex"),
    relayUrl: new URL(`${WHATSAPP_CLOUD_RELAY_PATH}/${instanceId}`, orchestratorInternalUrl).toString(),
  };
}

// Meta's two-step verification PIN for a number we register for the first time.
export function freshPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}
