import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";

export const GATEWAY_TOKEN = "gateway-token";

export interface GatewayRequest {
  method: string;
  params: Record<string, unknown>;
}

export type GatewayHandler = (method: string, params: Record<string, unknown>, socket: WebSocket) => unknown;

// A scripted gateway produces on demand what a live one rarely does: refusals, hangs, mid-call disconnects.
export async function withGateway(
  handler: GatewayHandler,
  run: (configPath: string) => Promise<{ stdout: string }>,
): Promise<{ stdout: string; requests: GatewayRequest[] }> {
  const requests: GatewayRequest[] = [];
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  server.on("connection", (socket) => {
    socket.on("message", (data) => {
      const frame = JSON.parse(String(data)) as { id: string } & GatewayRequest;
      requests.push({ method: frame.method, params: frame.params });
      let payload: unknown;
      try {
        payload = handler(frame.method, frame.params, socket);
      } catch (err) {
        const error = err as { message: string; code?: string };
        socket.send(
          JSON.stringify({
            type: "res",
            id: frame.id,
            ok: false,
            error: { code: error.code ?? "INVALID_REQUEST", message: error.message },
          }),
        );
        return;
      }
      if (payload === undefined) return;
      socket.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload }));
    });
  });

  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as { port: number };
  const configPath = await writeGatewayConfig(port);

  try {
    const { stdout } = await run(configPath);
    return { stdout, requests };
  } finally {
    server.close();
  }
}

export async function writeGatewayConfig(port: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "openclaw-gateway-"));
  const configPath = join(dir, "openclaw.json");
  await writeFile(configPath, JSON.stringify({ gateway: { port, auth: { mode: "token", token: GATEWAY_TOKEN } } }));
  return configPath;
}

export function runInContainerProgram(program: string, args: string[], stdin: string): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", program, ...args]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", reject);
    child.on("close", () => {
      assert.equal(stderr, "", `program wrote to stderr: ${stderr}`);
      resolve({ stdout });
    });
    child.stdin.end(stdin);
  });
}
