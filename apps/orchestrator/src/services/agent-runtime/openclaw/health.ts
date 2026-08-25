import type { Instance } from "../../../domain/types.js";
import type { ContainerRuntime } from "../../container-runtime.js";
import type { GatewayLiveness, WhatsappLinkState } from "../types.js";
import {
  buildGatewayProbeCommand,
  parseGatewayProbeOutput,
} from "./gateway-probe.js";
import {
  OPENCLAW_HEALTH_PATH,
  OPENCLAW_INTERNAL_PORT,
  OPENCLAW_READY_PATH,
  OPENCLAW_WHATSAPP_CHANNEL,
} from "./constants.js";

export async function probeOpenclawGateway(
  instance: Instance,
  timeoutMs: number,
  useDockerNetwork: boolean,
): Promise<GatewayLiveness> {
  const host = useDockerNetwork ? instance.containerName : "127.0.0.1";
  const port = useDockerNetwork ? OPENCLAW_INTERNAL_PORT : instance.gatewayPort;
  const base = `http://${host}:${port}`;

  if (!(await isOk(`${base}${OPENCLAW_HEALTH_PATH}`, timeoutMs))) {
    return { healthy: false, degraded: null };
  }
  // Readiness is observability only: it reports event-loop stalls and drain/startup states that
  // liveness cannot see, and must never gate the health decision itself.
  const ready = await isOk(`${base}${OPENCLAW_READY_PATH}`, timeoutMs);
  return { healthy: true, degraded: !ready };
}

export async function probeOpenclawWhatsapp(
  runtime: ContainerRuntime,
  instance: Instance,
  timeoutMs: number,
): Promise<WhatsappLinkState> {
  const containerId = await resolveRunningContainerId(runtime, instance);
  if (!containerId) return "probe_failed";

  try {
    const result = await runtime.execCommandWithOutput(
      containerId,
      buildGatewayProbeCommand(OPENCLAW_WHATSAPP_CHANNEL, timeoutMs),
      timeoutMs,
    );
    if (result.exitCode !== 0) return "probe_failed";
    return parseGatewayProbeOutput(result.stdout);
  } catch {
    return "probe_failed";
  }
}

async function isOk(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return resp.ok;
  } catch {
    return false;
  }
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
