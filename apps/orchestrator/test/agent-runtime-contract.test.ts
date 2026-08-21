import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenClawRuntimeAdapter } from "../src/services/agent-runtime/openclaw/adapter.js";
import { HermesRuntimeAdapter } from "../src/services/agent-runtime/hermes/adapter.js";
import type { AgentRuntimeAdapter } from "../src/services/agent-runtime/types.js";
import type { ContainerRuntime } from "../src/services/container-runtime.js";
import type { Instance } from "../src/domain/types.js";

test("OpenClaw adapter satisfies the agent runtime container contract", async () => {
  const adapter = new OpenClawRuntimeAdapter(
    {} as ContainerRuntime,
    "openclaw-image",
  );

  await assertAgentRuntimeContainerContract(adapter);
});

test("Hermes adapter satisfies the agent runtime container contract", async () => {
  const adapter = new HermesRuntimeAdapter(
    {} as ContainerRuntime,
    "hermes-image",
  );

  await assertAgentRuntimeContainerContract(adapter, {
    containerName: "hermes-4b86fc8b-ef1",
    image: "hermes-image",
    stateVolumeName: "hm-4b86fc8b-ef1-state",
    envPattern: /API_SERVER_KEY=token/,
    configPattern: /"custom_providers"|"model"/,
  });
});

async function assertAgentRuntimeContainerContract(
  adapter: AgentRuntimeAdapter,
  expected: {
    containerName: string;
    image: string;
    stateVolumeName: string;
    envPattern: RegExp;
    configPattern: RegExp;
  } = {
    containerName: "openclaw-4b86fc8b-ef1",
    image: "openclaw-image",
    stateVolumeName: "oc-4b86fc8b-ef1-state",
    envPattern: /OPENCLAW_GATEWAY_TOKEN=token/,
    configPattern: /"gateway"/,
  },
): Promise<void> {
  const options = await adapter.buildContainerOptions(instance);

  assert.equal(adapter.containerName(instance.id), expected.containerName);
  assert.equal(adapter.stateVolumeName(instance.id), expected.stateVolumeName);
  assert.equal(options.name, instance.containerName);
  assert.equal(options.image, expected.image);
  assert.equal(options.hostPort, instance.gatewayPort);
  assert.equal(options.labels["agent-forall.runtime"], adapter.kind);
  assert.ok(options.initialArchive);
  assert.ok(options.volumeMounts?.length);

  const files = adapter.generateConfig(instance.config, instance.gatewayToken);
  assert.match(files.configJson, expected.configPattern);
  assert.match(files.dotEnv, expected.envPattern);
}

const instance: Instance = {
  id: "4b86fc8b-ef19-496b-9591-583c72069443",
  userId: "user_1",
  hostId: "local-dev",
  runtimeKind: "openclaw",
  displayName: "Agent",
  status: "running",
  config: {
    displayName: "Agent",
    provider: { name: "openai", apiKey: "key", model: "gpt-5" },
    channels: [{ type: "whatsapp" }],
    resources: { memoryMb: 512, cpuShares: 256 },
  },
  containerId: "container-1",
  containerName: "openclaw-4b86fc8b-ef1",
  gatewayPort: 19000,
  gatewayToken: "token",
  healthFailures: 0,
  errorMessage: null,
  pairingStatus: "none",
  whatsappAccountId: null,
  hasWhatsappCreds: false,
  lastSeenAt: null,
  backupImport: {
    status: "none",
    objectName: null,
    contentLength: null,
    contentType: null,
  },
  litellm: {
    keyAlias: null,
    keyHash: null,
    budgetCents: null,
    budgetDuration: null,
  },
  createdAt: new Date(),
  updatedAt: new Date(),
  stoppedAt: null,
  destroyedAt: null,
};
