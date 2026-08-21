import type { Instance } from "../../../domain/types.js";
import type { ContainerRuntime } from "../../container-runtime.js";
import type { RuntimeHealthResult } from "../types.js";
import {
  HERMES_HEALTH_PATH,
  HERMES_INTERNAL_PORT,
} from "./constants.js";

export async function probeHermes(
  _runtime: ContainerRuntime,
  instance: Instance,
  timeoutMs: number,
  useDockerNetwork: boolean,
): Promise<RuntimeHealthResult> {
  const result = await checkGateway(instance, timeoutMs, useDockerNetwork);
  if (!result.gatewayHealthy || !needsWhatsappProbe(instance)) return result;
  return {
    gatewayHealthy: true,
    whatsappState: parseWhatsappState(result.detailedHealth),
  };
}

async function checkGateway(
  instance: Instance,
  timeoutMs: number,
  useDockerNetwork: boolean,
): Promise<RuntimeHealthResult & { detailedHealth?: unknown }> {
  const host = useDockerNetwork ? instance.containerName : "127.0.0.1";
  const port = useDockerNetwork ? HERMES_INTERNAL_PORT : instance.gatewayPort;

  try {
    const resp = await fetch(`http://${host}:${port}${HERMES_HEALTH_PATH}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return { gatewayHealthy: false, whatsappState: "unknown" };
    return {
      gatewayHealthy: true,
      whatsappState: "unknown",
      detailedHealth: await fetchDetailedHealth(host, port, timeoutMs),
    };
  } catch {
    return { gatewayHealthy: false, whatsappState: "unknown" };
  }
}

async function fetchDetailedHealth(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<unknown> {
  try {
    const resp = await fetch(`http://${host}:${port}/health/detailed`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return undefined;
    return resp.json() as Promise<unknown>;
  } catch {
    return undefined;
  }
}

function parseWhatsappState(
  detailedHealth: unknown,
): RuntimeHealthResult["whatsappState"] {
  if (!isRecord(detailedHealth)) return "unknown";
  const platforms = detailedHealth.platforms;
  if (!isRecord(platforms)) return "unknown";
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

function needsWhatsappProbe(instance: Instance): boolean {
  return (
    Boolean(instance.containerId) &&
    instance.hasWhatsappCreds &&
    instance.config.channels.some((ch) => ch.type === "whatsapp")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
