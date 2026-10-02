import { z } from "zod";
import type { ContainerRuntime } from "../../container-runtime.js";
import { UpstreamUnavailableError, ValidationError } from "../../../domain/errors.js";
import type { OwnerRoute } from "../../../domain/owner.js";
import type { OwnerTurn, OwnerTurnDelivery } from "../types.js";
import { MAIN_AGENT_ID, OWNER_SESSION_KEY } from "./config.js";
import { callOpenclawGateway, redactPeerIds } from "./gateway-call.js";

const CRON_CALL_TIMEOUT_MS = 15_000;
const TURN_TIMEOUT_SECONDS = 600;

const upsertedSchema = z.object({ job: z.object({ id: z.string().min(1) }) });

export function ownerTurnJob(route: OwnerRoute, turn: OwnerTurn): Record<string, unknown> {
  return {
    declarationKey: turn.key,
    name: turn.name,
    agentId: MAIN_AGENT_ID,
    // OpenClaw silently drops a timezone on "at", so the instant goes in UTC.
    schedule: { kind: "at", at: turn.at.toISOString() },
    sessionTarget: `session:${OWNER_SESSION_KEY}`,
    deleteAfterRun: true,
    payload: {
      kind: "agentTurn",
      message: turn.message,
      timeoutSeconds: TURN_TIMEOUT_SECONDS,
      ...(turn.toolsAllow ? { toolsAllow: turn.toolsAllow } : {}),
    },
    // Best effort drops an undelivered one-off instead of keeping it disabled; no alert ever reaches the owner.
    delivery: { mode: "announce", channel: route.channel, to: route.to, bestEffort: true },
    failureAlert: false,
  };
}

export async function scheduleOpenclawOwnerTurns(
  runtime: ContainerRuntime,
  containerId: string,
  route: OwnerRoute,
  turns: readonly OwnerTurn[],
): Promise<void> {
  for (const turn of turns) await addOpenclawOwnerTurn(runtime, containerId, route, turn);
}

// Returns the cron job id, which keeps naming the run in cron.runs after deleteAfterRun removed the job.
export async function addOpenclawOwnerTurn(
  runtime: ContainerRuntime,
  containerId: string,
  route: OwnerRoute,
  turn: OwnerTurn,
  timeoutMs = CRON_CALL_TIMEOUT_MS,
): Promise<string> {
  const result = await callOpenclawGateway(
    runtime,
    containerId,
    { method: "cron.add", params: ownerTurnJob(route, turn), scopes: ["operator.admin"] },
    timeoutMs,
  );
  const detail = (reason: string) => `cron.add ${turn.key}: ${redactPeerIds(reason)}`;
  if (result.status === "unreachable") throw new UpstreamUnavailableError("openclaw", detail(result.reason));
  if (result.status === "refused") throw new ValidationError(`openclaw refused ${detail(result.reason)}`);
  const upserted = upsertedSchema.safeParse(result.payload);
  if (!upserted.success) throw new ValidationError(`openclaw answered ${detail("unexpected cron.add response")}`);
  return upserted.data.job.id;
}

const lastRunSchema = z.object({
  entries: z.array(z.object({ status: z.string().optional(), deliveryStatus: z.string().optional() })),
});

// An errored run can still have delivered, and otherwise may be retried, so it stays pending. After an ok run
// "unknown" means the channel took the message without returning an id; counting it as delivered avoids a second alert.
export async function openclawOwnerTurnDelivery(
  runtime: ContainerRuntime,
  containerId: string,
  jobId: string,
): Promise<OwnerTurnDelivery> {
  const result = await callOpenclawGateway(
    runtime,
    containerId,
    { method: "cron.runs", params: { id: jobId, limit: 1 }, scopes: ["operator.read"] },
    CRON_CALL_TIMEOUT_MS,
  );
  if (result.status === "unreachable") return "pending";
  if (result.status === "refused") return "failed";
  const page = lastRunSchema.safeParse(result.payload);
  if (!page.success) return "failed";
  const run = page.data.entries[0];
  if (!run) return "pending";
  if (run.deliveryStatus === "delivered") return "delivered";
  if (run.status === "error") return "pending";
  return run.status === "ok" && run.deliveryStatus === "unknown" ? "delivered" : "failed";
}

export async function removeOpenclawOwnerTurn(runtime: ContainerRuntime, containerId: string, jobId: string): Promise<void> {
  const result = await callOpenclawGateway(
    runtime,
    containerId,
    { method: "cron.remove", params: { id: jobId }, scopes: ["operator.admin"] },
    CRON_CALL_TIMEOUT_MS,
  );
  if (result.status === "unreachable") throw new UpstreamUnavailableError("openclaw", `cron.remove: ${redactPeerIds(result.reason)}`);
}
