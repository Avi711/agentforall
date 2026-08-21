import type { ChannelConfig, Instance, InstanceConfig } from "../../src/domain/types.js";
import type { InstanceManager } from "../../src/services/instance-manager.js";

// Stand-in for services that only read channels and rewrite them through updateChannels.
export function fakeChannelManager(initial: Instance) {
  let inst = initial;
  const writes: ChannelConfig[][] = [];
  const manager = {
    get: async () => inst,
    updateChannels: async (
      _id: string,
      _userId: string,
      mutate: (channels: ChannelConfig[]) => ChannelConfig[],
    ) => {
      const next = mutate(inst.config.channels);
      if (next === inst.config.channels) return { instance: inst, changed: false };
      writes.push(next);
      inst = { ...inst, config: { ...inst.config, channels: next } };
      return { instance: inst, changed: true };
    },
  } as unknown as InstanceManager;
  return {
    manager,
    writes,
    instance: () => inst,
    reset: (next: Instance) => {
      inst = next;
    },
  };
}

export function configWith(channels: ChannelConfig[]): InstanceConfig {
  return {
    displayName: "Bot",
    provider: { name: "openai", apiKey: "k", model: "gpt-5" },
    channels,
    resources: { memoryMb: 1024, cpuShares: 512 },
  };
}

export function makeInstance(
  channels: ChannelConfig[],
  overrides: Partial<Instance> = {},
): Instance {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "user-1",
    hostId: "host",
    runtimeKind: "openclaw",
    displayName: "Bot",
    status: "running",
    config: configWith(channels),
    containerId: "container-1",
    containerName: "openclaw-1",
    gatewayPort: 20000,
    gatewayToken: "token",
    healthFailures: 0,
    errorMessage: null,
    pairingStatus: "paired",
    whatsappAccountId: "972555555555",
    hasWhatsappCreds: true,
    lastSeenAt: null,
    backupImport: { status: "none", objectName: null, contentLength: null, contentType: null },
    litellm: { keyAlias: null, keyHash: null, budgetCents: null, budgetDuration: null },
    createdAt: new Date("2026-08-21T00:00:00.000Z"),
    updatedAt: new Date("2026-08-21T00:00:00.000Z"),
    stoppedAt: null,
    destroyedAt: null,
    ...overrides,
  };
}
