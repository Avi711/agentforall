import { z } from "zod";
import type { ContainerRuntime } from "../../container-runtime.js";
import type { ChannelStartOutcome } from "../types.js";
import { callOpenclawGateway, type GatewayCallResult } from "./gateway-call.js";

const startPayloadSchema = z.object({
  started: z.boolean().nullish(),
  outcome: z.object({ status: z.string().nullish(), reason: z.string().nullish() }).nullish(),
});

// "skipped" means the runtime is already up, which for a fresh link is as good as started.
export function channelStartOutcomeOf(result: GatewayCallResult): ChannelStartOutcome {
  if (result.status !== "ok") return { status: "unavailable", reason: result.reason };
  const parsed = startPayloadSchema.safeParse(result.payload);
  if (!parsed.success) return { status: "unavailable", reason: "unexpected output shape" };
  const { started, outcome } = parsed.data;
  if (started === true || outcome?.status === "skipped") return { status: "started" };
  return { status: "unavailable", reason: outcome?.reason || outcome?.status || "not started" };
}

// The plugin keeps the config it started with, so routing changes reach it only through a restart of the channel.
export async function restartOpenclawChannel(
  runtime: ContainerRuntime,
  containerId: string,
  channel: string,
  timeoutMs: number,
): Promise<ChannelStartOutcome> {
  const stopped = await callOpenclawGateway(
    runtime,
    containerId,
    { method: "channels.stop", params: { channel }, scopes: ["operator.read", "operator.admin"] },
    timeoutMs,
  );
  if (stopped.status !== "ok") return { status: "unavailable", reason: stopped.reason };
  // A stopped channel stays down until started, so a failed start gets a second try.
  const started = await startOpenclawChannel(runtime, containerId, channel, timeoutMs);
  return started.status === "started" ? started : startOpenclawChannel(runtime, containerId, channel, timeoutMs);
}

export async function startOpenclawChannel(
  runtime: ContainerRuntime,
  containerId: string,
  channel: string,
  timeoutMs: number,
): Promise<ChannelStartOutcome> {
  const result = await callOpenclawGateway(
    runtime,
    containerId,
    // channels.start is admin-scoped.
    { method: "channels.start", params: { channel }, scopes: ["operator.read", "operator.admin"] },
    timeoutMs,
  );
  return channelStartOutcomeOf(result);
}
