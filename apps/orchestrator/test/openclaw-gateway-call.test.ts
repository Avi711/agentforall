import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildGatewayCallCommand,
  callOpenclawGateway,
  parseGatewayCallOutput,
  type GatewayCall,
} from "../src/services/agent-runtime/openclaw/gateway-call.js";
import type { ContainerRuntime } from "../src/services/container-runtime.js";
import { OPENCLAW_CONFIG_PATH } from "../src/services/agent-runtime/openclaw/constants.js";
import {
  GATEWAY_TOKEN,
  runInContainerProgram,
  withGateway,
  writeGatewayConfig,
} from "./helpers/fake-gateway.js";

const list: GatewayCall = { method: "cron.list", params: { compact: true }, scopes: ["operator.read"] };

function runCall(configPath: string, request: GatewayCall | string, timeoutMs = 6_000) {
  const program = buildGatewayCallCommand(timeoutMs)[2] as string;
  const stdin = typeof request === "string" ? request : JSON.stringify(request);
  return runInContainerProgram(program, [configPath, String(timeoutMs)], stdin);
}

test("the command carries only the config path and timeout; the request travels on stdin", () => {
  const cmd = buildGatewayCallCommand(9000);
  assert.deepEqual([cmd[0], cmd[1]], ["node", "-e"]);
  assert.deepEqual(cmd.slice(3), [OPENCLAW_CONFIG_PATH, "9000"]);
});

test("a call authenticates with the container's token and the scopes asked for, then returns the payload", async () => {
  const { stdout, requests } = await withGateway(
    (method) => (method === "cron.list" ? { jobs: [{ id: "j1", name: "x" }] } : {}),
    (path) => runCall(path, list),
  );

  assert.deepEqual(parseGatewayCallOutput(stdout), { status: "ok", payload: { jobs: [{ id: "j1", name: "x" }] } });
  assert.deepEqual(requests.map((r) => r.method), ["connect", "cron.list"]);
  assert.deepEqual((requests[0]?.params.auth as { token: string }).token, GATEWAY_TOKEN);
  assert.deepEqual(requests[0]?.params.scopes, ["operator.read"]);
  assert.deepEqual(requests[1]?.params, { compact: true });
});

test("a refusal keeps the gateway's code and message", async () => {
  const { stdout } = await withGateway(
    (method) => {
      if (method === "cron.add") throw Object.assign(new Error("invalid cron.add params"), { code: "INVALID_REQUEST" });
      return {};
    },
    (path) => runCall(path, { method: "cron.add", params: {}, scopes: ["operator.admin"] }),
  );

  assert.deepEqual(parseGatewayCallOutput(stdout), {
    status: "refused",
    code: "INVALID_REQUEST",
    reason: "invalid cron.add params",
  });
});

test("a refused handshake is the gateway's answer, not a missing gateway", async () => {
  const { stdout, requests } = await withGateway(
    (method) => {
      if (method === "connect") throw Object.assign(new Error("unauthorized"), { code: "INVALID_REQUEST" });
      return {};
    },
    (path) => runCall(path, list),
  );

  assert.equal(parseGatewayCallOutput(stdout).status, "refused");
  assert.deepEqual(requests.map((r) => r.method), ["connect"]);
});

test("a gateway that drops the socket mid-call has given no verdict", async () => {
  const { stdout } = await withGateway(
    (method, _params, socket) => {
      if (method === "cron.add") {
        socket.close();
        return undefined;
      }
      return {};
    },
    (path) => runCall(path, { method: "cron.add", params: {}, scopes: ["operator.admin"] }),
  );

  assert.equal(parseGatewayCallOutput(stdout).status, "unreachable");
});

test("a gateway that never answers stops at the deadline", async () => {
  const started = Date.now();
  const { stdout } = await withGateway(
    (method) => (method === "cron.list" ? undefined : {}),
    (path) => runCall(path, list, 2_000),
  );

  assert.deepEqual(parseGatewayCallOutput(stdout), { status: "unreachable", reason: "timeout" });
  assert.ok(Date.now() - started < 10_000);
});

test("a request that is not a call never reaches the gateway", async () => {
  const { stdout, requests } = await withGateway(() => ({}), (path) => runCall(path, "{ not json"));

  assert.deepEqual(parseGatewayCallOutput(stdout), { status: "unreachable", reason: "request-unusable" });
  assert.deepEqual(requests, []);
});

test("nothing listening on the gateway port is unreachable", async () => {
  const { stdout } = await runCall(await writeGatewayConfig(1), list, 3_000);
  assert.equal(parseGatewayCallOutput(stdout).status, "unreachable");
});

test("output that is not the program's result is never read as success", () => {
  assert.equal(parseGatewayCallOutput("").status, "unreachable");
  assert.equal(parseGatewayCallOutput("   \n  ").status, "unreachable");
  assert.equal(parseGatewayCallOutput("not json").status, "unreachable");
  assert.equal(parseGatewayCallOutput(JSON.stringify({ ok: "yes" })).status, "unreachable");
});

test("only the final line is read, so container noise cannot corrupt the answer", () => {
  const stdout = ["some unrelated noise", JSON.stringify({ ok: true, payload: { jobs: [] } }), ""].join("\n");
  assert.deepEqual(parseGatewayCallOutput(stdout), { status: "ok", payload: { jobs: [] } });
});

test("a gateway error without a message is reported by its code", async () => {
  const { stdout } = await withGateway(
    (method) => {
      if (method === "cron.list") throw Object.assign(new Error(""), { code: "UNAVAILABLE" });
      return {};
    },
    (path) => runCall(path, list),
  );
  assert.deepEqual(parseGatewayCallOutput(stdout), { status: "refused", code: "UNAVAILABLE", reason: "UNAVAILABLE" });
});

test("a container without a readable config or token is unreachable, never a refusal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openclaw-gateway-"));
  const tokenless = join(dir, "openclaw.json");
  await writeFile(tokenless, JSON.stringify({ gateway: { port: 1 } }));

  assert.deepEqual(parseGatewayCallOutput((await runCall(tokenless, list)).stdout), {
    status: "unreachable",
    reason: "missing-token",
  });
  assert.deepEqual(parseGatewayCallOutput((await runCall(join(dir, "missing.json"), list)).stdout), {
    status: "unreachable",
    reason: "config-unreadable",
  });
});

test("an exec that fails or cannot run is unreachable", async () => {
  const exiting = { execCommandBuffer: async () => ({ exitCode: 137, stdout: Buffer.from(""), stderr: "" }) };
  const throwing = {
    execCommandBuffer: async () => {
      throw new Error("container not running");
    },
  };
  assert.deepEqual(await callOpenclawGateway(exiting as unknown as ContainerRuntime, "c", list, 1000), {
    status: "unreachable",
    reason: "exit 137",
  });
  assert.deepEqual(await callOpenclawGateway(throwing as unknown as ContainerRuntime, "c", list, 1000), {
    status: "unreachable",
    reason: "container not running",
  });
});
