import { z } from "zod";
import type { ContainerRuntime } from "../../container-runtime.js";
import { UpstreamUnavailableError, ValidationError } from "../../../domain/errors.js";
import type { OwnerRoute } from "../../../domain/owner.js";
import type { OwnerTurn } from "../types.js";
import { MAIN_AGENT_ID, OWNER_SESSION_KEY } from "./config.js";
import { callOpenclawGateway } from "./gateway-call.js";

const CRON_CALL_TIMEOUT_MS = 15_000;
const TURN_TIMEOUT_SECONDS = 600;
// Owner numbers and Telegram ids as gateway errors quote them: E.164, WhatsApp JIDs, chat ids.
const PEER_ID_PATTERN = /\+?\d{7,}/g;

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
    payload: { kind: "agentTurn", message: turn.message, timeoutSeconds: TURN_TIMEOUT_SECONDS },
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
  for (const turn of turns) {
    const result = await callOpenclawGateway(
      runtime,
      containerId,
      { method: "cron.add", params: ownerTurnJob(route, turn), scopes: ["operator.admin"] },
      CRON_CALL_TIMEOUT_MS,
    );
    const detail = (reason: string) => `cron.add ${turn.key}: ${reason.replace(PEER_ID_PATTERN, "[redacted]")}`;
    if (result.status === "unreachable") throw new UpstreamUnavailableError("openclaw", detail(result.reason));
    if (result.status === "refused") throw new ValidationError(`openclaw refused ${detail(result.reason)}`);
    if (!upsertedSchema.safeParse(result.payload).success) {
      throw new ValidationError(`openclaw answered ${detail("unexpected cron.add response")}`);
    }
  }
}
