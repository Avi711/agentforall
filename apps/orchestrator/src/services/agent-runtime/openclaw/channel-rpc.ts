import { z } from "zod";
import type { ContainerRuntime } from "../../container-runtime.js";
import type { ChannelStartOutcome } from "../types.js";
import { OPENCLAW_CONFIG_PATH } from "./constants.js";

// Runs inside the tenant container: the gateway grants operator scopes only to loopback callers,
// and the token is read from the container's own config so it never appears in argv.
const CHANNEL_START_PROGRAM = String.raw`
const fs = require("node:fs");

function main() {
  const [configPath, channel, timeoutRaw] = process.argv.slice(1);
  let settled = false;
  let socket = null;

  const finish = (result) => {
    if (settled) return;
    settled = true;
    try { if (socket) socket.close(); } catch {}
    process.stdout.write(JSON.stringify(result), () => process.exit(0));
  };

  setTimeout(() => finish({ ok: false, error: "timeout" }), Number(timeoutRaw)).unref();

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return finish({ ok: false, error: "config-unreadable" });
  }

  const gateway = (config && config.gateway) || {};
  const token = gateway.auth && gateway.auth.token;
  if (!token) return finish({ ok: false, error: "missing-token" });

  socket = new WebSocket("ws://127.0.0.1:" + (gateway.port || 18789) + "/");
  let nextId = 0;
  const pending = new Map();

  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const id = String(++nextId);
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ type: "req", id, method, params }));
    });

  socket.onmessage = (event) => {
    let frame;
    try { frame = JSON.parse(String(event.data)); } catch { return; }
    if (frame.type !== "res") return;
    const waiter = pending.get(frame.id);
    if (!waiter) return;
    pending.delete(frame.id);
    if (frame.ok) waiter.resolve(frame.payload);
    else waiter.reject(new Error((frame.error && frame.error.message) || (frame.error && frame.error.code) || "rpc-error"));
  };

  socket.onerror = () => finish({ ok: false, error: "transport" });
  socket.onclose = () => finish({ ok: false, error: "closed" });

  socket.onopen = async () => {
    try {
      await send("connect", {
        minProtocol: 4,
        maxProtocol: 4,
        client: { id: "gateway-client", version: "1", platform: "linux", mode: "backend" },
        role: "operator",
        // channels.start is admin-scoped.
        scopes: ["operator.read", "operator.admin"],
        auth: { token },
      });
      const payload = await send("channels.start", { channel });
      const outcome = (payload && payload.outcome) || {};
      finish({
        ok: true,
        started: Boolean(payload && payload.started),
        status: outcome.status || null,
        reason: outcome.reason || null,
      });
    } catch (error) {
      finish({ ok: false, error: String((error && error.message) || error) });
    }
  };
}

main();
`;

const startOutputSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    started: z.boolean(),
    status: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
  }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

export function buildChannelStartCommand(channel: string, timeoutMs: number): string[] {
  return ["node", "-e", CHANNEL_START_PROGRAM, OPENCLAW_CONFIG_PATH, channel, String(timeoutMs)];
}

// "skipped" means the runtime is already up, which for a fresh link is as good as started.
export function parseChannelStartOutput(stdout: string): ChannelStartOutcome {
  const line = stdout.trim().split(/\r?\n/).at(-1);
  if (!line) return { status: "unavailable", reason: "no output" };

  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return { status: "unavailable", reason: "unparseable output" };
  }
  const parsed = startOutputSchema.safeParse(raw);
  if (!parsed.success) return { status: "unavailable", reason: "unexpected output shape" };
  if (!parsed.data.ok) return { status: "unavailable", reason: parsed.data.error };
  if (parsed.data.started || parsed.data.status === "skipped") return { status: "started" };
  return { status: "unavailable", reason: parsed.data.reason ?? parsed.data.status ?? "not started" };
}

export async function startOpenclawChannel(
  runtime: ContainerRuntime,
  containerId: string,
  channel: string,
  timeoutMs: number,
): Promise<ChannelStartOutcome> {
  try {
    const result = await runtime.execCommandWithOutput(
      containerId,
      buildChannelStartCommand(channel, timeoutMs),
      timeoutMs + 5_000,
    );
    if (result.exitCode !== 0) return { status: "unavailable", reason: `exit ${result.exitCode}` };
    return parseChannelStartOutput(result.stdout);
  } catch (err) {
    return { status: "unavailable", reason: err instanceof Error ? err.message : String(err) };
  }
}
