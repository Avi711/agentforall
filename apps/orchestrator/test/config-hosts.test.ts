import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPairingConfig, loadConfig } from "../src/config.js";

const BASE_ENV = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  ENCRYPTION_KEY: "a".repeat(64),
  ORCHESTRATOR_HOST_ID: "agent-forall-vm",
  API_KEYS: JSON.stringify({ ["k".repeat(32)]: "usr_test" }),
  WORKER_INSTANCE_IDS: "agent-forall-vm=1234567890123456789,worker-1=2234567890123456789",
  WORKER_ADDRESSES: "agent-forall-vm=10.164.0.4,worker-1=10.164.0.20",
};

function withEnv<T>(extra: Record<string, string>, run: () => T): T {
  const saved = { ...process.env };
  process.env = { ...BASE_ENV, ...extra };
  try {
    return run();
  } finally {
    process.env = saved;
  }
}

test("every listed worker has exactly one configured private address", () => {
  const config = withEnv({ WORKER_ADDRESSES: "agent-forall-vm=10.164.0.4, worker-1=10.164.0.20" }, loadConfig);
  assert.deepEqual([...config.workerAddresses], [["agent-forall-vm", "10.164.0.4"], ["worker-1", "10.164.0.20"]]);
  assert.equal(withEnv({}, loadConfig).workerAddresses.size, 2);
});

test("a worker without an address, an address for an unlisted host, or a public address is a configuration error", () => {
  assert.throws(() => withEnv({ WORKER_ADDRESSES: "agent-forall-vm=10.164.0.4" }, loadConfig), /WORKER_ADDRESSES.*worker-1/);
  assert.throws(
    () => withEnv({ WORKER_ADDRESSES: "agent-forall-vm=10.164.0.4,worker-1=10.164.0.20,worker-2=10.164.0.21" }, loadConfig),
    /WORKER_ADDRESSES.*worker-2/,
  );
  assert.throws(() => withEnv({ WORKER_ADDRESSES: "agent-forall-vm=10.164.0.4,worker-1=8.8.8.8" }, loadConfig), /WORKER_ADDRESSES/);
  assert.throws(() => withEnv({ WORKER_INSTANCE_IDS: "", WORKER_ADDRESSES: "worker-1=10.164.0.20" }, loadConfig), /WORKER_ADDRESSES/);
});

test("the pairing config carries the sidecar offset: gateway port 19000 publishes its sidecar on 18000", () => {
  assert.equal(extractPairingConfig(withEnv({}, loadConfig)).hostPortOffset, -1000);
});

test("the sidecar port range mirrors the gateway range one for one and may not overlap it", () => {
  assert.equal(withEnv({}, loadConfig).sidecarPortRangeStart, 18000);
  assert.equal(withEnv({ SIDECAR_PORT_RANGE_START: "21000" }, loadConfig).sidecarPortRangeStart, 21000);
  assert.throws(() => withEnv({ SIDECAR_PORT_RANGE_START: "19500" }, loadConfig), /SIDECAR_PORT_RANGE_START/);
  assert.throws(() => withEnv({ SIDECAR_PORT_RANGE_START: "65000" }, loadConfig), /SIDECAR_PORT_RANGE_START/);
});
