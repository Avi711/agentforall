import { test } from "node:test";
import assert from "node:assert/strict";
import type { VolumeMount } from "../src/services/container-runtime.js";
import { TENANT_CA_CONTAINER_PATH, withTenantCa } from "../src/services/tenant-ca.js";

const options = { envVars: ["A=1"], volumeMounts: [{ name: "oc-state", containerPath: "/home/node/.openclaw" }] };

test("with a CA path, the container trusts the internal CA through a read-only bind", () => {
  const trusted = withTenantCa(options, "/var/lib/agent-forall/ca/root.crt");

  assert.deepEqual(trusted.envVars, ["A=1", `NODE_EXTRA_CA_CERTS=${TENANT_CA_CONTAINER_PATH}`]);
  assert.deepEqual(trusted.volumeMounts.at(-1), {
    name: "/var/lib/agent-forall/ca/root.crt",
    containerPath: TENANT_CA_CONTAINER_PATH,
    readOnly: true,
  });
  assert.equal(options.volumeMounts.length, 1);
});

test("without a CA path the options are returned untouched", () => {
  assert.equal(withTenantCa(options, undefined), options);
});

test("a container with no mounts of its own still gets the CA bind", () => {
  const bare: { envVars: string[]; volumeMounts?: VolumeMount[] } = { envVars: [] };
  assert.equal(withTenantCa(bare, "/ca.crt").volumeMounts?.length, 1);
});
