import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConfigApplyCommand } from "../src/services/agent-runtime/openclaw/config-rpc.js";
import {
  runInContainerProgram,
  withGateway as withFakeGateway,
  writeGatewayConfig,
  type GatewayHandler,
} from "./helpers/fake-gateway.js";

async function withGateway(
  handler: GatewayHandler,
  run: (configPath: string) => Promise<{ stdout: string }>,
): Promise<{ stdout: string; requests: string[] }> {
  const { stdout, requests } = await withFakeGateway(handler, run);
  return { stdout, requests: requests.map((request) => request.method) };
}

function runProgram(
  configPath: string,
  stdin: string,
  timeoutMs = 6_000,
): Promise<{ stdout: string }> {
  const program = buildConfigApplyCommand(timeoutMs)[2] as string;
  return runInContainerProgram(program, [configPath, String(timeoutMs)], stdin);
}

const config = JSON.stringify({ channels: { telegram: { enabled: true } } });
const accept: GatewayHandler = (method) => {
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
  // Port 1 is reserved and never has a listener.
  const configPath = await writeGatewayConfig(1);

  const { stdout } = await runProgram(configPath, config, 3_000);

  const result = JSON.parse(stdout) as { stage: string; transport: boolean };
  assert.equal(result.stage, "connect");
  assert.equal(result.transport, true);
});
