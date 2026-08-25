import { z } from "zod";
import { OPENCLAW_CONFIG_PATH } from "./constants.js";

// Runs inside the tenant container: the gateway grants operator scopes only to loopback callers.
// The token is read from the container's own config and the config arrives on stdin, so neither
// appears in argv. String.raw keeps escape sequences out of the template literal.
const CONFIG_APPLY_PROGRAM = String.raw`
const fs = require("node:fs");

function main() {
  const [configPath, timeoutRaw] = process.argv.slice(1);
  const deadline = Date.now() + Number(timeoutRaw);
  let settled = false;

  const finish = (result) => {
    if (settled) return;
    settled = true;
    process.stdout.write(JSON.stringify(result), () => process.exit(0));
  };
  // The stage separates "the gateway refused this config" from "we never got a verdict".
  const fail = (stage, error) =>
    finish({
      ok: false,
      stage,
      transport: Boolean(error && error.transport),
      code: (error && error.code) || null,
      message: String((error && error.message) || error),
    });
  const transportError = (message) => {
    const error = new Error(message);
    error.transport = true;
    return error;
  };
  const at = (stage, error) => Object.assign(error, { stage: error.stage || stage });

  setTimeout(() => fail("write", transportError("timeout")), Number(timeoutRaw)).unref();

  let configRaw;
  try {
    configRaw = fs.readFileSync(0, "utf8");
    JSON.parse(configRaw);
  } catch {
    return fail("connect", transportError("config-input-unusable"));
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return fail("connect", transportError("config-unreadable"));
  }

  const gateway = (config && config.gateway) || {};
  const token = gateway.auth && gateway.auth.token;
  if (!token) return fail("connect", transportError("missing-token"));
  const url = "ws://127.0.0.1:" + (gateway.port || 18789) + "/";

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const open = () =>
    new Promise((resolve, reject) => {
      let socket;
      try {
        socket = new WebSocket(url);
      } catch (error) {
        return reject(transportError(String((error && error.message) || error)));
      }
      let nextId = 0;
      let ready = false;
      const pending = new Map();
      const close = () => { try { socket.close(); } catch {} };

      const drop = () => {
        const error = transportError("gateway-disconnected");
        for (const waiter of pending.values()) waiter.reject(error);
        pending.clear();
        reject(error);
      };

      socket.onmessage = (event) => {
        let frame;
        try { frame = JSON.parse(String(event.data)); } catch { return; }
        if (frame.type !== "res") return;
        const waiter = pending.get(frame.id);
        if (!waiter) return;
        pending.delete(frame.id);
        if (frame.ok) return waiter.resolve(frame.payload);
        const error = new Error((frame.error && frame.error.message) || "rpc-error");
        error.code = (frame.error && frame.error.code) || null;
        waiter.reject(error);
      };
      socket.onerror = drop;
      socket.onclose = drop;

      const send = (method, params) =>
        new Promise((res, rej) => {
          const id = String(++nextId);
          pending.set(id, { resolve: res, reject: rej });
          socket.send(JSON.stringify({ type: "req", id, method, params }));
        });

      socket.onopen = async () => {
        try {
          await send("connect", {
            minProtocol: 4,
            maxProtocol: 4,
            client: { id: "gateway-client", version: "1", platform: "linux", mode: "backend" },
            role: "operator",
            // config.* is admin-scoped; operator.write is not enough.
            scopes: ["operator.read", "operator.admin"],
            auth: { token },
          });
          ready = true;
          resolve({ send, close });
        } catch (error) {
          close();
          reject(error);
        }
      };
      // A handshake that never completes must not leave the socket open.
      setTimeout(() => { if (!ready) close(); }, Math.max(0, deadline - Date.now())).unref();
    });

  const applyOnce = async () => {
    let session;
    try {
      session = await open();
    } catch (error) {
      throw at("connect", error);
    }
    try {
      const current = await session.send("config.get", {}).catch((error) => {
        throw at("read", error);
      });
      if (!current || typeof current.hash !== "string") {
        throw at("read", new Error("config.get returned no hash"));
      }
      // baseHash makes the gateway refuse the write if the config moved since this read.
      await session.send("config.apply", { raw: configRaw, baseHash: current.hash }).catch((error) => {
        throw at("write", error);
      });
    } finally {
      session.close();
    }
  };

  // A change the gateway cannot hot-apply makes it restart, dropping the socket before the
  // response. Applying the same config again is idempotent, so an explicit acknowledgement on
  // reconnect is the only thing that proves the write landed — a changed hash proves nothing.
  const applyUntilAcknowledged = async () => {
    let last = at("write", transportError("gateway did not come back after restarting"));
    while (Date.now() < deadline - 2000) {
      await sleep(500);
      try {
        await applyOnce();
        return finish({ ok: true });
      } catch (error) {
        last = error;
        if (!error || !error.transport) break;
      }
    }
    return fail(last.stage || "write", last);
  };

  (async () => {
    try {
      await applyOnce();
      return finish({ ok: true });
    } catch (error) {
      if (!error || !error.transport || error.stage === "connect") {
        return fail((error && error.stage) || "write", error);
      }
    }
    await applyUntilAcknowledged();
  })();
}

main();
`;

const applyOutputSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    stage: z.enum(["connect", "read", "write"]),
    transport: z.boolean(),
    code: z.string().nullable(),
    message: z.string(),
  }),
]);

export type ConfigApplyResult =
  | { status: "applied" }
  // No session with the gateway, so the file it reads on its next boot is the only way in.
  | { status: "unreachable"; reason: string }
  // The gateway answered but never ruled on this config. Writing the file blind is the
  // fire-and-forget path this mechanism exists to remove, so the caller retries instead.
  | { status: "unconfirmed"; reason: string }
  // The gateway read this config and refused it.
  | { status: "rejected"; reason: string };

export function buildConfigApplyCommand(timeoutMs: number): string[] {
  return ["node", "-e", CONFIG_APPLY_PROGRAM, OPENCLAW_CONFIG_PATH, String(timeoutMs)];
}

export function parseConfigApplyOutput(stdout: string): ConfigApplyResult {
  const parsed = parseApplyLine(stdout.trim().split(/\r?\n/).at(-1) ?? "");
  if (parsed === null) {
    return { status: "unconfirmed", reason: "config apply returned no usable result" };
  }
  if (parsed.ok) return { status: "applied" };

  const { stage, transport, code, message } = parsed;
  // Never established a session, so the gateway holds no opinion on this config.
  if (stage === "connect") return { status: "unreachable", reason: message };
  // Connected, then the gateway went away and never came back.
  if (transport) return { status: "unreachable", reason: message };
  // UNAVAILABLE is the gateway's retryable class (rate limit, still starting), not a verdict.
  if (stage === "read" || code === "UNAVAILABLE") return { status: "unconfirmed", reason: message };
  return { status: "rejected", reason: message };
}

function parseApplyLine(line: string): z.infer<typeof applyOutputSchema> | null {
  try {
    const parsed = applyOutputSchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
