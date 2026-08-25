import type { Readable } from "node:stream";
import type { AgentRuntimeKind, Instance, InstanceConfig } from "../../domain/types.js";
import type { ContainerCreateOptions, ArchiveStreamResult } from "../container-runtime.js";

export type { AgentRuntimeKind };

export interface RuntimeConfigFiles {
  configJson: string;
  dotEnv: string;
}

// "unknown" means no state was established; the two failure states are kept distinct so a
// broken probe is never mistaken for a genuinely disconnected channel.
export type WhatsappLinkState =
  | "connected"
  | "disconnected"
  | "unknown"
  | "probe_failed"
  | "protocol_error";

// "restart_required" means the change is only staged on disk, so it is not live until the
// container boots again. Only "applied" means a running runtime acknowledged it.
export type ConfigApplyOutcome = "applied" | "restart_required";

export interface GatewayLiveness {
  healthy: boolean;
  // null when the runtime exposes no readiness signal separate from liveness.
  degraded: boolean | null;
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

  containerName(instanceId: string): string;
  stateVolumeName(instanceId: string): string;
  buildContainerOptions(instance: Instance): Promise<ContainerCreateOptions>;
  generateConfig(config: InstanceConfig, gatewayToken: string): RuntimeConfigFiles;
  // Writes config for the container's next boot. Callers that restart afterwards use this.
  writeConfig(containerId: string, instance: Instance): Promise<void>;
  // Applies config to a running runtime without restarting it, and reports what actually happened.
  applyConfig(containerId: string, instance: Instance): Promise<ConfigApplyOutcome>;
  injectWhatsappSession(containerId: string, credsTar: Buffer): Promise<void>;
  exportState(containerId: string): Promise<ArchiveStreamResult>;
  restoreState(containerId: string, sourceTarGzip: Readable): Promise<void>;
  probeGateway(instance: Instance, timeoutMs: number, useDockerNetwork: boolean): Promise<GatewayLiveness>;
  // Runs inside the container: the gateway only grants operator scopes to loopback callers.
  probeWhatsapp(instance: Instance, timeoutMs: number, useDockerNetwork: boolean): Promise<WhatsappLinkState>;
  // true once the stored WhatsApp session is gone from the container (it cannot resurrect on restart).
  logoutWhatsapp(containerId: string): Promise<boolean>;
  // Senders waiting for DM approval (dmPolicy "pairing"); empty when the runtime has no pairing store.
  listWhatsappPairingRequests(containerId: string): Promise<WhatsappPairingRequest[]>;
  // Owner peer ids the live runtime config currently holds; null when the runtime has no owner concept.
  readOwnerIds(containerId: string): Promise<string[] | null>;
}
