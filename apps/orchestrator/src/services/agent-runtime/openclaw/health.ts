import type { Instance } from "../../../domain/types.js";
import type { ContainerRuntime } from "../../container-runtime.js";
import type { RuntimeHealthResult } from "../types.js";
import {
  OPENCLAW_HEALTH_PATH,
  OPENCLAW_INTERNAL_PORT,
} from "./constants.js";

export async function probeOpenclaw(
  runtime: ContainerRuntime,
  instance: Instance,
  timeoutMs: number,
  useDockerNetwork: boolean,
): Promise<RuntimeHealthResult> {
  const gatewayHealthy = await checkGateway(
    instance,
    timeoutMs,
    useDockerNetwork,
  );
  if (!gatewayHealthy || !needsWhatsappProbe(instance)) {
    return { gatewayHealthy, whatsappState: "unknown" };
  }
  return {
    gatewayHealthy,
    whatsappState: await checkWhatsappChannel(runtime, instance, timeoutMs),
  };
}

async function checkGateway(
  instance: Instance,
  timeoutMs: number,
  useDockerNetwork: boolean,
): Promise<boolean> {
  const host = useDockerNetwork ? instance.containerName : "127.0.0.1";
  const port = useDockerNetwork ? OPENCLAW_INTERNAL_PORT : instance.gatewayPort;

  try {
    const resp = await fetch(`http://${host}:${port}${OPENCLAW_HEALTH_PATH}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

async function checkWhatsappChannel(
  runtime: ContainerRuntime,
  instance: Instance,
  timeoutMs: number,
): Promise<RuntimeHealthResult["whatsappState"]> {
  const containerId = await resolveRunningContainerId(runtime, instance);
  if (!containerId) return "unknown";

  const result = await runtime.execCommandWithOutput(
    containerId,
    [
      "openclaw",
      "channels",
      "status",
      "--channel",
      "whatsapp",
      "--probe",
      "--json",
      "--timeout",
      String(Math.max(timeoutMs, 15_000)),
    ],
    Math.max(timeoutMs, 15_000),
  );
  if (result.exitCode !== 0) return "unknown";
  return parseWhatsappState(result.stdout);
}

async function resolveRunningContainerId(
  runtime: ContainerRuntime,
  instance: Instance,
): Promise<string | null> {
  if (instance.containerId) {
    const current = await runtime.inspect(instance.containerId);
    if (current?.State.Running) return instance.containerId;
  }
  return runtime.findContainerByName(instance.containerName);
}

function parseWhatsappState(output: string): RuntimeHealthResult["whatsappState"] {
  const jsonState = parseWhatsappJsonState(output);
  if (jsonState !== "unknown") return jsonState;

  const line = output
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .find((value) => /WhatsApp\s+default:/i.test(value));
  if (!line) return "unknown";

  const normalized = line.toLowerCase();
  if (normalized.includes("disconnected") || normalized.includes("stopped")) {
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

function parseWhatsappJsonState(
  output: string,
): RuntimeHealthResult["whatsappState"] {
  try {
    const parsed: unknown = JSON.parse(output);
    const text = JSON.stringify(parsed).toLowerCase();
    if (!text.includes("whatsapp")) return "unknown";
    if (
      text.includes("disconnected") ||
      text.includes("logged_out") ||
      text.includes("logged out") ||
      text.includes("not linked") ||
      text.includes("stopped")
    ) {
      return "disconnected";
    }
    if (
      text.includes("connected") ||
      text.includes("running") ||
      text.includes("ready") ||
      text.includes("works") ||
      text.includes("audit ok")
    ) {
      return "connected";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

function needsWhatsappProbe(instance: Instance): boolean {
  return (
    Boolean(instance.containerId) &&
    instance.hasWhatsappCreds &&
    instance.config.channels.some((ch) => ch.type === "whatsapp")
  );
}
