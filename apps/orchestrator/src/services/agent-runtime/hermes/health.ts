import type { GatewayLiveness, WhatsappLinkState } from "../types.js";
import { HERMES_HEALTH_PATH } from "./constants.js";

export async function probeHermesGateway(base: string, timeoutMs: number): Promise<GatewayLiveness> {
  try {
    const resp = await fetch(`${base}${HERMES_HEALTH_PATH}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Hermes exposes no readiness signal separate from liveness.
    return { healthy: resp.ok, degraded: null };
  } catch {
    return { healthy: false, degraded: null };
  }
}

export async function probeHermesWhatsapp(base: string, timeoutMs: number): Promise<WhatsappLinkState> {
  let detailed: unknown;
  try {
    const resp = await fetch(`${base}/health/detailed`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return "probe_failed";
    detailed = await resp.json();
  } catch {
    return "probe_failed";
  }
  return parseWhatsappState(detailed);
}

function parseWhatsappState(detailedHealth: unknown): WhatsappLinkState {
  if (!isRecord(detailedHealth)) return "protocol_error";
  const platforms = detailedHealth.platforms;
  if (!isRecord(platforms)) return "protocol_error";
  const whatsapp = platforms.whatsapp ?? platforms.WhatsApp;
  if (!whatsapp) return "unknown";
  const normalized =
    typeof whatsapp === "string"
      ? whatsapp.toLowerCase()
      : JSON.stringify(whatsapp).toLowerCase();

  // "disconnected" contains "connected", so failure markers must be checked first.
  if (
    normalized.includes("disconnected") ||
    normalized.includes("fatal") ||
    normalized.includes("failed") ||
    normalized.includes("logged_out") ||
    normalized.includes("logged out") ||
    normalized.includes("stopped")
  ) {
    return "disconnected";
  }
  if (
    normalized.includes("connected") ||
    normalized.includes("running") ||
    normalized.includes("ready")
  ) {
    return "connected";
  }
  return "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
