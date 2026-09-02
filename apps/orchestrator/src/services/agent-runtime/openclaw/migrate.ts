import type { ContainerRuntime } from "../../container-runtime.js";
import { UpstreamUnavailableError } from "../../../domain/errors.js";
import { buildOpenclawWorkspaceFileTar } from "./config.js";
import { OPENCLAW_STATE_PARENT, OPENCLAW_STATE_ROOT, OPENCLAW_WORKSPACE_PATH } from "./constants.js";

const DOCTOR_TIMEOUT_MS = 15 * 60 * 1000;
const PLUGIN_UPDATE_TIMEOUT_MS = 5 * 60 * 1000;
const ONE_OFF_MEMORY_BYTES = 2 * 1024 * 1024 * 1024;
const WHATSAPP_PLUGIN = "@openclaw/whatsapp";
const AGENTS_FILE_NAME = "AGENTS.md";
const AGENTS_FILE_PATH = `${OPENCLAW_WORKSPACE_PATH}/${AGENTS_FILE_NAME}`;
const AGENTS_READ_LIMIT_BYTES = 1024 * 1024;
const GUIDANCE_BEGIN = "<!-- agentforall:begin -->";
const GUIDANCE_END = "<!-- agentforall:end -->";

export const AGENTFORALL_GUIDANCE = [
  GUIDANCE_BEGIN,
  "You run on agentforall. Integrations (Gmail, Google Calendar, Sheets, Notion, Slack and ~1,400 more)",
  "connect in one tap through the agentforall connections tool: find the app, send the owner the connect",
  "link it returns, and continue once it's connected. Prefer this over manual setup.",
  "The owner can also manage integrations, billing and settings at https://agentforall.co.il/app/bot/connections.",
  GUIDANCE_END,
].join("\n");

export function buildDoctorCommand(): string[] {
  return ["openclaw", "doctor", "--fix", "--non-interactive"];
}

export function buildWhatsappPluginUpdateCommand(): string[] {
  return ["openclaw", "plugins", "update", WHATSAPP_PLUGIN];
}

// Doctor migrates stores and config offline; the WhatsApp plugin lives in the volume, so it is updated explicitly.
export async function prepareOpenclawState(
  runtime: ContainerRuntime,
  opts: { image: string; volumeName: string; containerName: string; withWhatsapp: boolean },
): Promise<void> {
  await runOffline(runtime, opts, "doctor", buildDoctorCommand(), DOCTOR_TIMEOUT_MS);
  if (opts.withWhatsapp) {
    await runOffline(runtime, opts, "whatsapp-plugin", buildWhatsappPluginUpdateCommand(), PLUGIN_UPDATE_TIMEOUT_MS);
  }
}

async function runOffline(
  runtime: ContainerRuntime,
  opts: { image: string; volumeName: string; containerName: string },
  step: string,
  cmd: string[],
  timeoutMs: number,
): Promise<void> {
  const result = await runtime.runOneOff({
    name: `${opts.containerName}-${step}`,
    image: opts.image,
    cmd,
    timeoutMs,
    memoryBytes: ONE_OFF_MEMORY_BYTES,
    volumeMounts: [{ name: opts.volumeName, containerPath: OPENCLAW_STATE_ROOT }],
  });
  if (result.exitCode !== 0) {
    throw new UpstreamUnavailableError("openclaw", `${step} exited ${result.exitCode}: ${tail(result.output)}`);
  }
}

// One orchestrator-owned block between markers; the rest of the file is the tenant's and the runtime's.
export async function seedOpenclawWorkspace(runtime: ContainerRuntime, containerId: string): Promise<void> {
  const existing = await runtime.readFile(containerId, AGENTS_FILE_PATH, AGENTS_READ_LIMIT_BYTES);
  const current = existing?.toString("utf8") ?? "";
  const next = mergeGuidance(current, AGENTFORALL_GUIDANCE);
  if (next === current) return;
  await runtime.putArchive(
    containerId,
    OPENCLAW_STATE_PARENT,
    await buildOpenclawWorkspaceFileTar(AGENTS_FILE_NAME, next),
  );
}

export function mergeGuidance(existing: string, guidance: string): string {
  const begin = existing.indexOf(GUIDANCE_BEGIN);
  const end = existing.indexOf(GUIDANCE_END, begin);
  if (begin >= 0 && end >= 0) {
    return existing.slice(0, begin) + guidance + existing.slice(end + GUIDANCE_END.length);
  }
  const body = existing.replace(/\s+$/, "");
  return body.length === 0 ? `${guidance}\n` : `${body}\n\n${guidance}\n`;
}

function tail(text: string): string {
  return text.trim().split(/\r?\n/).slice(-5).join(" | ").slice(-600);
}
