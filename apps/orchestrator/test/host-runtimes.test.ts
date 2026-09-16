import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentRuntimeRegistry } from "../src/services/agent-runtime/registry.js";
import type { ContainerRuntime } from "../src/services/container-runtime.js";
import { StaticHostRuntimes, dialUrl, type HostRuntime } from "../src/services/host-runtimes.js";
import { UnknownHostError } from "../src/domain/errors.js";

function host(hostId: string): HostRuntime {
  return {
    hostId,
    address: null,
    capacityMb: null,
    status: "active",
    restartPolicy: "unless-stopped",
    dockerNetwork: true,
    runtime: {} as ContainerRuntime,
    adapters: {} as AgentRuntimeRegistry,
    gate: { check: async () => true },
  };
}

test("for() returns the bundle registered under that host id", () => {
  const a = host("host-a");
  const b = host("host-b");
  const hosts = new StaticHostRuntimes([a, b]);
  assert.equal(hosts.for("host-a"), a);
  assert.equal(hosts.for("host-b"), b);
});

test("for() throws UnknownHostError (503) for a host it does not manage", () => {
  const hosts = new StaticHostRuntimes([host("host-a")]);
  assert.throws(
    () => hosts.for("host-z"),
    (err: unknown) =>
      err instanceof UnknownHostError &&
      err.statusCode === 503 &&
      err.code === "HOST_UNAVAILABLE" &&
      err.message === "host host-z is not managed by this orchestrator",
  );
});

test("all() lists every registered bundle", () => {
  const a = host("host-a");
  const b = host("host-b");
  assert.deepEqual(new StaticHostRuntimes([a, b]).all(), [a, b]);
});

test("setCapacity records a reported size on the existing bundle and refuses an unknown host", () => {
  const a = host("host-a");
  const hosts = new StaticHostRuntimes([a]);
  hosts.setCapacity("host-a", 16_000);
  assert.equal(hosts.for("host-a").capacityMb, 16_000);
  assert.equal(hosts.for("host-a").runtime, a.runtime, "same client, only the figure changes");
  assert.throws(() => hosts.setCapacity("host-z", 1), UnknownHostError);
});

test("upsert replaces a bundle in place and appends an unknown one", () => {
  const a = host("host-a");
  const b = host("host-b");
  const hosts = new StaticHostRuntimes([a, b]);
  const a2 = host("host-a");
  hosts.upsert(a2);
  assert.equal(hosts.for("host-a"), a2);
  assert.deepEqual(hosts.all(), [a2, b]);
  const c = host("host-c");
  hosts.upsert(c);
  assert.deepEqual(hosts.all(), [a2, b, c]);
});

test("dialUrl reaches a worker by address and published port, the local host by container name, dev by loopback", () => {
  const instance = { containerName: "openclaw-abc", gatewayPort: 19005 };
  assert.equal(dialUrl({ address: "10.0.0.9", dockerNetwork: true }, instance, 18789), "http://10.0.0.9:19005");
  assert.equal(dialUrl({ address: null, dockerNetwork: true }, instance, 18789), "http://openclaw-abc:18789");
  assert.equal(dialUrl({ address: null, dockerNetwork: false }, instance, 18789), "http://127.0.0.1:19005");
});
