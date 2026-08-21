import type { Readable } from "node:stream";
import type { AgentRuntimeKind, Instance, InstanceConfig } from "../../domain/types.js";
import type { ContainerCreateOptions, ArchiveStreamResult } from "../container-runtime.js";

export type { AgentRuntimeKind };

export interface RuntimeConfigFiles {
  configJson: string;
  dotEnv: string;
}

export interface RuntimeHealthResult {
  gatewayHealthy: boolean;
  whatsappState: "connected" | "disconnected" | "unknown";
}

export interface WhatsappPairingRequest {
  number: string;
  code: string;
  name: string | null;
  requestedAt: string;
}

export interface AgentRuntimeAdapter {
  kind: AgentRuntimeKind;
  image: string;
  maxBackupBytes: number;
  // true when the runtime watches its config file and applies changes itself (no container restart).
  hotReloadsConfig: boolean;

  containerName(instanceId: string): string;
  stateVolumeName(instanceId: string): string;
  buildContainerOptions(instance: Instance): Promise<ContainerCreateOptions>;
  generateConfig(config: InstanceConfig, gatewayToken: string): RuntimeConfigFiles;
  refreshConfig(containerId: string, instance: Instance): Promise<void>;
  injectWhatsappSession(containerId: string, credsTar: Buffer): Promise<void>;
  exportState(containerId: string): Promise<ArchiveStreamResult>;
  restoreState(containerId: string, sourceTarGzip: Readable): Promise<void>;
  probe(instance: Instance, timeoutMs: number, useDockerNetwork: boolean): Promise<RuntimeHealthResult>;
  // true once the stored WhatsApp session is gone from the container (it cannot resurrect on restart).
  logoutWhatsapp(containerId: string): Promise<boolean>;
  // Senders waiting for DM approval (dmPolicy "pairing"); empty when the runtime has no pairing store.
  listWhatsappPairingRequests(containerId: string): Promise<WhatsappPairingRequest[]>;
  // Owner peer ids the live runtime config currently holds; null when the runtime has no owner concept.
  readOwnerIds(containerId: string): Promise<string[] | null>;
}
