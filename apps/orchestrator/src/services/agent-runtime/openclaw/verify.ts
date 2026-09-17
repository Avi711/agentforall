import { errorMessage } from "../../../domain/errors.js";
import type { ContainerRuntime, ExecResult } from "../../container-runtime.js";
import type { RuntimeCheck } from "../types.js";

const EXEC_TIMEOUT_MS = 60_000;
const WHATSAPP_PLUGIN_ID = "whatsapp";

export interface OpenclawVerifyInput {
  expectedPlugins: readonly string[];
  ownedConfigInPlace: () => Promise<boolean>;
}

interface ListedPlugin {
  id: string;
  status: string;
  version: string | null;
}

// What must hold for a bot after any rebuild. Health, the image and the row are the manager's to report.
export async function verifyOpenclaw(
  runtime: ContainerRuntime,
  containerId: string,
  input: OpenclawVerifyInput,
): Promise<RuntimeCheck[]> {
  const listed = await listPlugins(runtime, containerId);
  return [
    checkPluginsLoaded(listed, input.expectedPlugins),
    await checkWhatsappPluginVersion(runtime, containerId, listed),
    await checkConfigValid(runtime, containerId),
    check("orchestrator settings in place", await input.ownedConfigInPlace().catch(() => false), "a re-render changes the live config"),
  ];
}

function check(name: string, ok: boolean, failure: string): RuntimeCheck {
  return { name, ok, detail: ok ? null : failure };
}

// A wedged bot times out or dies mid-exec; that is a failed check, the very bot a rebuild is for.
async function exec(runtime: ContainerRuntime, containerId: string, cmd: string[]): Promise<ExecResult> {
  try {
    return await runtime.execCommandWithOutput(containerId, cmd, EXEC_TIMEOUT_MS);
  } catch (err) {
    return { exitCode: -1, stdout: "", stderr: errorMessage(err) };
  }
}

// null = the listing could not be read, which must fail the checks that depend on it.
async function listPlugins(runtime: ContainerRuntime, containerId: string): Promise<ListedPlugin[] | null> {
  const result = await exec(runtime, containerId, ["openclaw", "plugins", "list", "--json"]);
  if (result.exitCode !== 0) return null;
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    const plugins = (parsed as { plugins?: unknown }).plugins;
    if (!Array.isArray(plugins)) return null;
    return plugins.flatMap((entry: unknown) => {
      const p = entry as { id?: unknown; status?: unknown; version?: unknown };
      if (typeof p.id !== "string") return [];
      return [{ id: p.id, status: typeof p.status === "string" ? p.status : "unknown", version: typeof p.version === "string" ? p.version : null }];
    });
  } catch {
    // Unparseable output is no evidence that anything loaded.
    return null;
  }
}

function checkPluginsLoaded(listed: ListedPlugin[] | null, expected: readonly string[]): RuntimeCheck {
  const name = "plugins loaded";
  if (!listed) return check(name, false, "the plugin listing could not be read");
  const byId = new Map(listed.map((p) => [p.id, p]));
  const bad = expected
    .filter((id) => byId.get(id)?.status !== "loaded")
    .map((id) => `${id} (${byId.get(id)?.status ?? "missing"})`);
  return check(name, bad.length === 0, bad.join(", "));
}

// The WhatsApp plugin lives in every volume and only works with the core it was published for.
async function checkWhatsappPluginVersion(
  runtime: ContainerRuntime,
  containerId: string,
  listed: ListedPlugin[] | null,
): Promise<RuntimeCheck> {
  const name = "whatsapp plugin matches the core";
  if (!listed) return check(name, false, "the plugin listing could not be read");
  const plugin = listed.find((p) => p.id === WHATSAPP_PLUGIN_ID);
  const result = await exec(runtime, containerId, ["openclaw", "--version"]);
  const core = result.exitCode === 0 ? (result.stdout.trim().split(/\s+/)[1] ?? null) : null;
  const ok = plugin?.version != null && core !== null && plugin.version === core;
  return check(name, ok, `plugin ${plugin?.version ?? "missing"}, core ${core ?? "unknown"}`);
}

async function checkConfigValid(runtime: ContainerRuntime, containerId: string): Promise<RuntimeCheck> {
  const result = await exec(runtime, containerId, ["openclaw", "config", "validate"]);
  return check("config valid", result.exitCode === 0, (result.stderr || result.stdout).trim().slice(-300));
}
