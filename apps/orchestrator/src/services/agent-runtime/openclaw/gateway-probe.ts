import { z } from "zod";
import type { WhatsappLinkState } from "../types.js";
import { OPENCLAW_CONFIG_PATH } from "./constants.js";

// The gateway grants operator scopes only to loopback callers, so this program runs inside the
// tenant container. It reads the token from the container's own config instead of taking it as an
// argument, keeping the secret out of argv and process listings. String.raw so that adding an
// escape sequence here can never be consumed by the template literal.
const GATEWAY_PROBE_PROGRAM = String.raw`
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
    else waiter.reject(new Error((frame.error && frame.error.code) || "rpc-error"));
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
        scopes: ["operator.read"],
        auth: { token },
      });
      // Unfiltered: asking for one channel errors when it is not registered, while the full
      // listing simply omits it -- a structural signal that needs no error-string matching.
      const payload = await send("channels.status", {});
      const accounts =
        payload && payload.channelAccounts && payload.channelAccounts[channel];
      const account = Array.isArray(accounts) ? accounts[0] : null;
      finish({
        ok: true,
        account: account
          ? { linked: account.linked, connected: account.connected }
          : null,
      });
    } catch (error) {
      finish({ ok: false, error: String((error && error.message) || error) });
    }
  };
}

main();
`;

const probeOutputSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    account: z
      .object({ linked: z.boolean().optional(), connected: z.boolean().optional() })
      .nullable(),
  }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

export function buildGatewayProbeCommand(
  channel: string,
  timeoutMs: number,
): string[] {
  return [
    "node",
    "-e",
    GATEWAY_PROBE_PROGRAM,
    OPENCLAW_CONFIG_PATH,
    channel,
    String(timeoutMs),
  ];
}

// Only an explicit link/connect answer is trusted; every other outcome stays a failure state so a
// broken probe can never be mistaken for a genuinely disconnected channel. An absent account means
// the gateway no longer registers the channel, which for a credentialed tenant is a real disconnect.
export function parseGatewayProbeOutput(stdout: string): WhatsappLinkState {
  const line = stdout.trim().split(/\r?\n/).at(-1);
  if (!line) return "protocol_error";

  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return "protocol_error";
  }

  const parsed = probeOutputSchema.safeParse(raw);
  if (!parsed.success) return "protocol_error";
  if (!parsed.data.ok) return "probe_failed";

  const account = parsed.data.account;
  if (!account) return "disconnected";
  if (account.linked === false) return "disconnected";
  if (account.connected === true) return "connected";
  if (account.connected === false) return "disconnected";
  return "unknown";
}
