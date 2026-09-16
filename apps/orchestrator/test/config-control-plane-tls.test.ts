import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

const BASE_ENV = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  ENCRYPTION_KEY: "a".repeat(64),
  ORCHESTRATOR_HOST_ID: "agent-forall-vm",
  API_KEYS: JSON.stringify({ ["k".repeat(32)]: "usr_test" }),
};

function withEnv(extra: Record<string, string>, run: () => void): void {
  const saved = { ...process.env };
  process.env = { ...BASE_ENV, ...extra };
  try {
    run();
  } finally {
    process.env = saved;
  }
}

test("all three TLS paths form the controlPlaneTls group", () => {
  withEnv(
    { CONTROL_PLANE_CA_PATH: "/ca.pem", ORCHESTRATOR_CLIENT_CERT_PATH: "/cert.pem", ORCHESTRATOR_CLIENT_KEY_PATH: "/key.pem" },
    () => {
      const config = loadConfig();
      assert.deepEqual(config.controlPlaneTls, { caPath: "/ca.pem", certPath: "/cert.pem", keyPath: "/key.pem" });
      assert.equal("controlPlaneCaPath" in config, false);
    },
  );
});

test("none set (prod today) leaves controlPlaneTls undefined; empty strings count as unset", () => {
  withEnv({}, () => assert.equal(loadConfig().controlPlaneTls, undefined));
  withEnv({ CONTROL_PLANE_CA_PATH: "", ORCHESTRATOR_CLIENT_CERT_PATH: "" }, () => assert.equal(loadConfig().controlPlaneTls, undefined));
});

test("a partial TLS group is a configuration error", () => {
  withEnv({ CONTROL_PLANE_CA_PATH: "/ca.pem" }, () =>
    assert.throws(loadConfig, { message: /must be set together/ }),
  );
});
