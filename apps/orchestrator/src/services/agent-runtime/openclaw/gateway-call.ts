import { z } from "zod";
import type { ContainerRuntime } from "../../container-runtime.js";
import { errorMessage } from "../../../domain/errors.js";
import { OPENCLAW_CONFIG_PATH } from "./constants.js";

// In-container because the gateway grants operator scopes only to loopback callers; token and request never touch argv.
const GATEWAY_CALL_PROGRAM = String.raw`
const fs = require("node:fs");

function main() {
  const [configPath, timeoutRaw] = process.argv.slice(1);
  let settled = false;
  let socket = null;

  const finish = (result) => {
    if (settled) return;
    settled = true;
    try { if (socket) socket.close(); } catch {}
    process.stdout.write(JSON.stringify(result), () => process.exit(0));
  };
  const fail = (transport, error) =>
    finish({
      ok: false,
      transport,
      code: (error && error.code) || null,
      message: String((error && error.message) || error),
    });

  setTimeout(() => fail(true, "timeout"), Number(timeoutRaw)).unref();

  let request;
  try {
    request = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return fail(true, "request-unusable");
  }
  if (!request || typeof request.method !== "string" || !Array.isArray(request.scopes)) {
    return fail(true, "request-unusable");
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return fail(true, "config-unreadable");
  }
  const gateway = (config && config.gateway) || {};
  const token = gateway.auth && gateway.auth.token;
  if (!token) return fail(true, "missing-token");

  try {
    socket = new WebSocket("ws://127.0.0.1:" + (gateway.port || 18789) + "/");
  } catch (error) {
    return fail(true, error);
  }
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
    if (frame.ok) return waiter.resolve(frame.payload);
    const error = new Error((frame.error && (frame.error.message || frame.error.code)) || "rpc-error");
    error.code = (frame.error && frame.error.code) || null;
    waiter.reject(error);
  };
  socket.onerror = () => fail(true, "transport");
  socket.onclose = () => fail(true, "closed");

  socket.onopen = async () => {
    try {
      await send("connect", {
        minProtocol: 4,
        maxProtocol: 4,
        client: { id: "gateway-client", version: "1", platform: "linux", mode: "backend" },
        role: "operator",
        scopes: request.scopes,
        auth: { token },
      });
      finish({ ok: true, payload: await send(request.method, request.params || {}) });
    } catch (error) {
      fail(false, error);
    }
  };
}

main();
`;

export type GatewayScope = "operator.read" | "operator.write" | "operator.admin";

export interface GatewayCall {
  method: string;
  params: Record<string, unknown>;
  scopes: GatewayScope[];
}

export type GatewayCallResult =
  | { status: "ok"; payload: unknown }
  // No verdict from the gateway: nothing listening, the socket dropped, or no answer in time.
  | { status: "unreachable"; reason: string }
  | { status: "refused"; code: string | null; reason: string };

const callOutputSchema = z.union([
  z.object({ ok: z.literal(true), payload: z.unknown() }),
  z.object({ ok: z.literal(false), transport: z.boolean(), code: z.string().nullable(), message: z.string() }),
]);

const MAX_OUTPUT_BYTES = 1024 * 1024;

export function buildGatewayCallCommand(timeoutMs: number): string[] {
  return ["node", "-e", GATEWAY_CALL_PROGRAM, OPENCLAW_CONFIG_PATH, String(timeoutMs)];
}

export function parseGatewayCallOutput(stdout: string): GatewayCallResult {
  const line = stdout.trim().split(/\r?\n/).at(-1) ?? "";
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return { status: "unreachable", reason: "unparseable output" };
  }
  const parsed = callOutputSchema.safeParse(raw);
  if (!parsed.success) return { status: "unreachable", reason: "unexpected output shape" };
  if (parsed.data.ok) return { status: "ok", payload: parsed.data.payload };
  if (parsed.data.transport) return { status: "unreachable", reason: parsed.data.message };
  return { status: "refused", code: parsed.data.code, reason: parsed.data.message };
}

export async function callOpenclawGateway(
  runtime: ContainerRuntime,
  containerId: string,
  call: GatewayCall,
  timeoutMs: number,
): Promise<GatewayCallResult> {
  try {
    const result = await runtime.execCommandBuffer(
      containerId,
      buildGatewayCallCommand(timeoutMs),
      timeoutMs + 5_000,
      MAX_OUTPUT_BYTES,
      Buffer.from(JSON.stringify(call), "utf8"),
    );
    if (result.exitCode !== 0) return { status: "unreachable", reason: `exit ${result.exitCode}` };
    return parseGatewayCallOutput(result.stdout.toString("utf8"));
  } catch (err) {
    return { status: "unreachable", reason: errorMessage(err) };
  }
}
