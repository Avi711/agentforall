import { z } from "zod";
import type { ContainerRuntime } from "../../container-runtime.js";
import { normalizeE164 } from "../../../domain/phone.js";
import type { WhatsappPairingRequest, WhatsappLogoutResult } from "../types.js";
import {
  OPENCLAW_USER,
  OPENCLAW_WHATSAPP_CHANNEL,
  OPENCLAW_WHATSAPP_SESSION_DIR,
  OPENCLAW_WHATSAPP_SESSION_PARENT,
  OPENCLAW_WHATSAPP_SESSION_PATH,
} from "./constants.js";

const LOGOUT_TIMEOUT_MS = 20_000;
const PAIRING_LIST_TIMEOUT_MS = 20_000;
const PAIRING_LIST_MAX_STDOUT_BYTES = 256 * 1024;

// `openclaw pairing list whatsapp --json` (verified against openclaw 2026.7.1 pairing-cli).
const PairingListOutput = z.object({
  channel: z.string(),
  requests: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      createdAt: z.string(),
      lastSeenAt: z.string().optional(),
      meta: z.record(z.string(), z.string()).optional(),
    }),
  ),
});

export function injectOpenclawWhatsappSession(
  runtime: ContainerRuntime,
  containerId: string,
  credsTar: Buffer,
): Promise<void> {
  return runtime.putArchiveUnderDir(
    containerId,
    OPENCLAW_WHATSAPP_SESSION_PARENT,
    OPENCLAW_WHATSAPP_SESSION_DIR,
    credsTar,
    OPENCLAW_USER,
  );
}

// CLI logout unlinks the device server-side (best-effort: it fails once the phone already removed it);
// wiping the auth dir is what guarantees the session can't resurrect on restart.
export async function logoutOpenclawWhatsapp(
  runtime: ContainerRuntime,
  containerId: string,
): Promise<WhatsappLogoutResult> {
  const unlinkExit = await runtime.execCommand(
    containerId,
    ["openclaw", "channels", "logout", "--channel", OPENCLAW_WHATSAPP_CHANNEL, "--account", "default"],
    LOGOUT_TIMEOUT_MS,
  );
  const clearExit = await runtime.execCommand(
    containerId,
    ["sh", "-c", `rm -rf -- "${OPENCLAW_WHATSAPP_SESSION_PATH}"/* "${OPENCLAW_WHATSAPP_SESSION_PATH}"/.[!.]*`],
    LOGOUT_TIMEOUT_MS,
  );
  return { unlinked: unlinkExit === 0, cleared: clearExit === 0 };
}

export async function listOpenclawWhatsappPairingRequests(
  runtime: ContainerRuntime,
  containerId: string,
): Promise<WhatsappPairingRequest[]> {
  const result = await runtime.execCommandBuffer(
    containerId,
    ["openclaw", "pairing", "list", "whatsapp", "--json"],
    PAIRING_LIST_TIMEOUT_MS,
    PAIRING_LIST_MAX_STDOUT_BYTES,
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `openclaw pairing list exited ${result.exitCode}`);
  }
  return parsePairingListOutput(result.stdout.toString("utf8"));
}

export function parsePairingListOutput(stdout: string): WhatsappPairingRequest[] {
  const parsed = PairingListOutput.parse(JSON.parse(stdout));
  const requests: WhatsappPairingRequest[] = [];
  for (const req of parsed.requests) {
    const number = normalizeE164(req.id);
    if (!number) continue;
    requests.push({
      number,
      code: req.code,
      name: req.meta?.name?.trim() || null,
      requestedAt: req.createdAt,
    });
  }
  return requests;
}
