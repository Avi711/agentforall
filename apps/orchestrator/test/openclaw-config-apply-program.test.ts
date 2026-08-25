import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { buildConfigApplyCommand } from "../src/services/agent-runtime/openclaw/config-rpc.js";

const TOKEN = "gateway-token";

type Handler = (method: string, params: Record<string, unknown>, socket: WebSocket) => unknown;

// The program only ever talks to a real gateway, so the only honest way to pin its behaviour is
// to run it against one. Scripted stand-ins cover the paths a live container cannot produce
// on demand: rate limits, hangs, and a gateway that restarts mid-write.
async function withGateway(
  handler: Handler,
  run: (configPath: string) => Promise<{ stdout: string }>,
): Promise<{ stdout: string; requests: string[] }> {
  const requests: string[] = [];
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  server.on("connection", (socket) => {
    socket.on("message", (data) => {
      const frame = JSON.parse(String(data)) as {
        id: string;
        method: string;
        params: Record<string, unknown>;
      };
      requests.push(frame.method);
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
      if (payload === undefined) return; // deliberate silence
      socket.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload }));
    });
  });

  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as { port: number };

  const dir = await mkdtemp(join(tmpdir(), "openclaw-apply-"));
  const configPath = join(dir, "openclaw.json");
  await writeFile(
    configPath,
    JSON.stringify({ gateway: { port, auth: { mode: "token", token: TOKEN } } }),
  );

  try {
    const { stdout } = await run(configPath);
    return { stdout, requests };
  } finally {
    server.close();
  }
}

function runProgram(
  configPath: string,
  stdin: string,
  timeoutMs = 6_000,
): Promise<{ stdout: string }> {
  const program = buildConfigApplyCommand(timeoutMs)[2] as string;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", program, configPath, String(timeoutMs)]);
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

const config = JSON.stringify({ channels: { telegram: { enabled: true } } });
const accept: Handler = (method) => {
  if (method === "connect") return {};
  if (method === "config.get") return { hash: "hash-1" };
  return {};
};

test("a gateway that acknowledges the write reports applied", async () => {
  const { stdout, requests } = await withGateway(accept, (path) => runProgram(path, config));

  assert.deepEqual(JSON.parse(stdout), { ok: true });
  assert.deepEqual(requests, ["connect", "config.get", "config.apply"]);
});

test("the config travels on stdin and carries the hash the gateway just gave", async () => {
  const applied: { raw?: string; baseHash?: string }[] = [];
  await withGateway((method, params) => {
    if (method === "config.apply") applied.push(params);
    return method === "config.get" ? { hash: "hash-7" } : {};
  }, (path) => runProgram(path, config));

  assert.equal(applied[0]?.raw, config);
  assert.equal(applied[0]?.baseHash, "hash-7");
});

// The documented success path: the gateway restarts itself and the socket dies before the reply.
test("a gateway that restarts mid-write is confirmed by re-applying, not by guesswork", async () => {
  let applies = 0;
  const { stdout, requests } = await withGateway((method, _params, socket) => {
    if (method === "config.get") return { hash: `hash-${applies}` };
    if (method === "config.apply") {
      applies += 1;
      if (applies === 1) {
        socket.close();
        return undefined;
      }
    }
    return {};
  }, (path) => runProgram(path, config));

  assert.deepEqual(JSON.parse(stdout), { ok: true });
  assert.equal(applies, 2);
  assert.equal(requests.filter((m) => m === "config.apply").length, 2);
});

test("a gateway that never comes back is a transport failure, not a verdict", async () => {
  const { stdout } = await withGateway((method, _params, socket) => {
    if (method === "config.get") return { hash: "hash-1" };
    if (method === "config.apply") {
      socket.close();
      return undefined;
    }
    return {};
  }, (path) => runProgram(path, config, 3_000));

  const result = JSON.parse(stdout) as { ok: boolean; transport: boolean };
  assert.equal(result.ok, false);
  assert.equal(result.transport, true);
});

test("a refused config is reported against the write, with the gateway's own code", async () => {
  const { stdout } = await withGateway((method) => {
    if (method === "config.get") return { hash: "hash-1" };
    if (method === "config.apply") {
      throw Object.assign(new Error("invalid config: must be boolean"), {
        code: "INVALID_REQUEST",
      });
    }
    return {};
  }, (path) => runProgram(path, config));

  assert.deepEqual(JSON.parse(stdout), {
    ok: false,
    stage: "write",
    transport: false,
    code: "INVALID_REQUEST",
    message: "invalid config: must be boolean",
  });
});

// A live gateway refusing our credentials is not the same as no gateway at all.
test("an authentication refusal is answered by the gateway, so it is not a transport failure", async () => {
  const { stdout } = await withGateway((method) => {
    if (method === "connect") {
      throw Object.assign(new Error("unauthorized: gateway token mismatch"), {
        code: "INVALID_REQUEST",
      });
    }
    return {};
  }, (path) => runProgram(path, config));

  const result = JSON.parse(stdout) as { stage: string; transport: boolean };
  assert.equal(result.stage, "connect");
  assert.equal(result.transport, false);
});

test("a rate-limited write keeps the gateway's retry code instead of retrying blindly", async () => {
  let applies = 0;
  const { stdout } = await withGateway((method) => {
    if (method === "config.get") return { hash: "hash-1" };
    if (method === "config.apply") {
      applies += 1;
      throw Object.assign(new Error("rate limit exceeded for config.apply"), {
        code: "UNAVAILABLE",
      });
    }
    return {};
  }, (path) => runProgram(path, config));

  const result = JSON.parse(stdout) as { code: string; stage: string };
  assert.equal(result.code, "UNAVAILABLE");
  assert.equal(result.stage, "write");
  assert.equal(applies, 1, "a rate-limited write must not be retried into the same window");
});

test("a gateway that reads but cannot answer config.get is reported against the read", async () => {
  const { stdout } = await withGateway((method) => {
    if (method === "config.get") throw Object.assign(new Error("not ready"), { code: "NOT_READY" });
    return {};
  }, (path) => runProgram(path, config));

  const result = JSON.parse(stdout) as { stage: string; transport: boolean };
  assert.equal(result.stage, "read");
  assert.equal(result.transport, false);
});

test("a config.get without a hash is refused rather than applied without a base", async () => {
  let applies = 0;
  const { stdout } = await withGateway((method) => {
    if (method === "config.apply") applies += 1;
    return {};
  }, (path) => runProgram(path, config));

  const result = JSON.parse(stdout) as { ok: boolean; stage: string };
  assert.equal(result.ok, false);
  assert.equal(result.stage, "read");
  assert.equal(applies, 0);
});

test("a gateway that goes silent mid-write stops at the deadline instead of hanging", async () => {
  const started = Date.now();
  const { stdout } = await withGateway((method) => {
    if (method === "config.get") return { hash: "hash-1" };
    if (method === "config.apply") return undefined; // never answers
    return {};
  }, (path) => runProgram(path, config, 2_500));

  const result = JSON.parse(stdout) as { ok: boolean; message: string };
  assert.equal(result.ok, false);
  assert.equal(result.message, "timeout");
  assert.ok(Date.now() - started < 15_000);
});

test("input that is not a config never reaches the gateway", async () => {
  const { stdout, requests } = await withGateway(accept, (path) =>
    runProgram(path, "{ not json"),
  );

  const result = JSON.parse(stdout) as { ok: boolean; message: string };
  assert.equal(result.ok, false);
  assert.equal(result.message, "config-input-unusable");
  assert.deepEqual(requests, []);
});

test("nothing listening on the gateway port is a transport failure at connect", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openclaw-apply-"));
  const configPath = join(dir, "openclaw.json");
  // Port 1 is reserved and never has a listener.
  await writeFile(configPath, JSON.stringify({ gateway: { port: 1, auth: { token: TOKEN } } }));

  const { stdout } = await runProgram(configPath, config, 3_000);

  const result = JSON.parse(stdout) as { stage: string; transport: boolean };
  assert.equal(result.stage, "connect");
  assert.equal(result.transport, true);
});
