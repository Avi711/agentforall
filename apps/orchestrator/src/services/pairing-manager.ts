import { randomBytes } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { InstanceRepository } from "../storage/instance-repository.js";
import type { ContainerRuntime } from "./container-runtime.js";
import type { EventRepository } from "../storage/event-repository.js";
import type { Instance } from "../domain/types.js";
import type { AgentRuntimeRegistry } from "./agent-runtime/registry.js";
import {
  AuthenticationError,
  InvalidStateError,
  NotFoundError,
  UpstreamUnavailableError,
  errorMessage,
} from "../domain/errors.js";
import type { PairingConfig } from "../config.js";
import { PairingSessionRegistry } from "./pairing-session-registry.js";
import type { PairingSidecarClient } from "./pairing-sidecar-client.js";
import { PAIRING_USER, tmpfsOptions } from "./runtime-users.js";
import { findWhatsappChannel } from "../domain/channels.js";

const SIDECAR_TMPFS_SIZE_MB = 16;
const LINK_WAIT_MS = 45_000;
const LINK_POLL_MS = 2_000;
const LINK_PROBE_TIMEOUT_MS = 5_000;
const HELLO_ATTEMPTS = 3;
const HELLO_RETRY_MS = 3_000;
const READY_EVENT = "pair.ready";
const AUTHENTICATED_EVENT = "pair.authenticated";

export function helloMessage(displayName: string): string {
  return `היי, זה ${displayName} 👋 החיבור הצליח. אפשר לכתוב לי כאן כל דבר.`;
}

export interface StartPairingResult {
  status: "started" | "already_active";
  expiresInMs: number;
}

// Per-pair auth token lives in memory only ג€” orchestrator restart mid-pair is
// recovered by the reconciler tearing down the orphan; user retries.
export class PairingManager {
  constructor(
    private readonly repo: InstanceRepository,
    private readonly runtime: ContainerRuntime,
    private readonly runtimes: AgentRuntimeRegistry,
    private readonly eventLog: EventRepository,
    private readonly pairing: PairingConfig,
    private readonly logger: FastifyBaseLogger,
    private readonly sessions: PairingSessionRegistry,
    private readonly sidecarClient: PairingSidecarClient,
  ) {}

  async startPairing(instance: Instance): Promise<StartPairingResult> {
    return this.sessions.withInstanceLock(instance.id, () =>
      this.startPairingLocked(instance),
    );
  }

  private async startPairingLocked(instance: Instance): Promise<StartPairingResult> {
    if (!instance.containerId) {
      throw new InvalidStateError(instance.status, "pair");
    }
    if (instance.pairingStatus === "paired") {
      throw new InvalidStateError("paired", "pair");
    }

    if (await this.reclaimMissingSession(instance)) {
      return this.startPairingLocked({ ...instance, pairingStatus: "failed" });
    }

    const existing = this.sessions.get(instance.id);
    if (existing) {
      const running = await this.runtime.isRunning(existing.sidecarContainerId);
      if (running) {
        return {
          status: "already_active",
          expiresInMs: this.pairing.idleTimeoutMs,
        };
      }
      await this.teardownSidecar(instance.id, "zombie");
    }

    // Mark DB before container creation so the reconciler can find orphans after a crash.
    const claimed = await this.repo.updatePairing(
      instance.id,
      { pairingStatus: "awaiting_qr" },
      { expectedPairingStatus: ["none", "expired", "failed"] },
    );
    if (!claimed) {
      return {
        status: "already_active",
        expiresInMs: this.pairing.idleTimeoutMs,
      };
    }
    await this.eventLog.append(instance.id, "pair.requested", {
      actor: instance.userId,
    });

    const shortId = instance.id.slice(0, 12);
    const sidecarName = `pairing-${shortId}`;
    const authToken = randomBytes(32).toString("hex");

    try {
      await this.runtime.removeIfExists(sidecarName);

      // tmpfs session dir ג€” sidecar tars and POSTs creds on success; nothing on host disk.
      const sidecarId = await this.runtime.createSidecar({
        name: sidecarName,
        image: this.pairing.image,
        envVars: this.buildSidecarEnv(instance.id, authToken),
        memoryBytes: 256 * 1024 * 1024,
        cpuShares: 256,
        labels: {
          "agent-forall.instance-id": instance.id,
          "agent-forall.role": "pairing",
        },
        volumeMounts: [],
        tmpfsMounts: [
          {
            path: "/data/session",
            options: tmpfsOptions(PAIRING_USER, SIDECAR_TMPFS_SIZE_MB),
          },
        ],
        ...(this.pairing.publishSidecarPort
          ? { publishPort: this.pairing.port }
          : {}),
      });

      try {
        await this.runtime.start(sidecarId);
      } catch (err) {
        await this.runtime.remove(sidecarId).catch(() => undefined);
        throw err;
      }

      const sidecarHostPort = this.pairing.publishSidecarPort
        ? await this.runtime.getPublishedHostPort(sidecarId, this.pairing.port)
        : null;
      if (this.pairing.publishSidecarPort && sidecarHostPort === null) {
        throw new UpstreamUnavailableError("pairing sidecar port");
      }

      this.sessions.set({
        instanceId: instance.id,
        sidecarContainerId: sidecarId,
        sidecarContainerName: sidecarName,
        sidecarHostPort,
        authToken,
        createdAt: new Date(),
      });

      this.logger.info(
        { instanceId: instance.id, sidecar: sidecarName },
        "pairing started",
      );
      return { status: "started", expiresInMs: this.pairing.idleTimeoutMs };
    } catch (err) {
      // Roll DB back so re-pair starts from a known state. No volume to clean (tmpfs).
      await this.repo
        .updatePairing(
          instance.id,
          { pairingStatus: "failed" },
          { expectedPairingStatus: "awaiting_qr" },
        )
        .catch(() => undefined);
      throw err;
    }
  }

  private buildSidecarEnv(instanceId: string, authToken: string): string[] {
    return [
      `PAIRING_PORT=${this.pairing.port}`,
      `PAIRING_HOST=0.0.0.0`,
      `PAIRING_AUTH_TOKEN=${authToken}`,
      `ORCHESTRATOR_BASE_URL=${this.pairing.orchestratorInternalUrl}`,
      `ORCHESTRATOR_SERVICE_TOKEN=${authToken}`,
      `INSTANCE_ID=${instanceId}`,
      `SESSION_DIR=/data/session`,
      `IDLE_TIMEOUT_MS=${this.pairing.idleTimeoutMs}`,
      `LOG_LEVEL=${this.pairing.logLevel}`,
    ];
  }

  // Always XOR-compares against either the real or DUMMY token so latency
  // doesn't leak whether a pairing session exists.
  validateAuthToken(instanceId: string, token: string): boolean {
    return this.sessions.validateToken(instanceId, token);
  }

  async proxyToSidecar(
    instanceId: string,
    path: string,
    init: { method: string; body?: unknown; headers?: Record<string, string> },
  ): Promise<{ status: number; body: unknown }> {
    const result = await this.sidecarClient.proxy(instanceId, path, init);
    this.logger.info(
      { instanceId, upstreamStatus: result.status, path },
      "sidecar responded",
    );
    return result;
  }

  // Best-effort: deletion must proceed even if the messaging runtime cannot log out.
  // Resolves true once the stored session is gone; never throws so destroy paths stay best-effort.
  async logoutWhatsapp(instanceId: string, containerId: string): Promise<boolean> {
    try {
      const inst = await this.repo.findById(instanceId);
      if (!inst) throw new NotFoundError("instance", instanceId);
      const { unlinked, cleared } = await this.runtimes.get(inst.runtimeKind).logoutWhatsapp(containerId);
      if (!unlinked) this.logger.warn({ instanceId }, "whatsapp device unlink did not complete server-side");
      if (cleared) {
        await this.eventLog.append(instanceId, "pair.logged_out");
        this.logger.info({ instanceId }, "whatsapp logout succeeded");
      } else {
        await this.eventLog.append(instanceId, "pair.logout_failed", {
          payload: { exitCode: 1 },
        });
        this.logger.warn({ instanceId }, "whatsapp logout exited non-zero");
      }
      return cleared;
    } catch (err) {
      await this.eventLog.append(instanceId, "pair.logout_failed", {
        payload: { error: errorMessage(err) },
      });
      this.logger.warn({ instanceId, err: errorMessage(err) }, "whatsapp logout failed");
      return false;
    }
  }

  async completePairing(
    instance: Instance,
    credsTarGz: Buffer,
    accountId: string | null,
  ): Promise<void> {
    if (!instance.containerId) {
      throw new InvalidStateError(instance.status, "pair_complete");
    }

    const applied = await this.persistPairedState(instance.id, credsTarGz, accountId);
    if (!applied) {
      this.logger.warn(
        { instanceId: instance.id },
        "pairing already completed ג€” teardown and skip",
      );
      await this.teardownSidecar(instance.id, "duplicate_callback");
      return;
    }

    await this.eventLog.append(instance.id, AUTHENTICATED_EVENT, {
      payload: { accountId: accountId ?? null },
    });
    await this.teardownSidecar(instance.id, "completed");
    // The sidecar's callback times out in seconds; linking and the hello take longer than that.
    void this.activateWhatsapp(instance, instance.containerId, credsTarGz).catch((err) => {
      this.logger.error({ instanceId: instance.id, err: errorMessage(err) }, "whatsapp activation crashed");
    });
  }

  // True once the linked channel is up and the hello went out (or was given up on) after the
  // latest link, so the dashboard can tell "linking" from "ready to chat".
  async isReady(instanceId: string): Promise<boolean> {
    const events = await this.eventLog.recent(instanceId, 30);
    for (const event of events) {
      if (event.eventType === READY_EVENT) return true;
      if (event.eventType === AUTHENTICATED_EVENT) return false;
    }
    return false;
  }

  async completePairingCallback(
    instanceId: string,
    token: string | null,
    credsTarGz: Buffer,
    accountId: string | null,
  ): Promise<void> {
    if (!token || !this.validateAuthToken(instanceId, token)) {
      throw new AuthenticationError();
    }

    const inst = await this.repo.findById(instanceId);
    if (!inst) throw new NotFoundError("instance", instanceId);
    await this.completePairing(inst, credsTarGz, accountId);
  }

  // CAS awaiting_* ג†’ paired with creds in one write; false on concurrent loss.
  private persistPairedState(
    instanceId: string,
    creds: Buffer,
    accountId: string | null,
  ): Promise<boolean> {
    return this.repo.updatePairing(
      instanceId,
      {
        whatsappCreds: creds,
        whatsappAccountId: accountId,
        pairingStatus: "paired",
      },
      { expectedPairingStatus: ["awaiting_qr", "awaiting_code"] },
    );
  }

  // Creds go in and only the channel runtime starts, so the gateway keeps serving; a restart is the
  // fallback, not the path. On failure the DB still holds the creds and the next boot re-injects.
  private async activateWhatsapp(
    instance: Instance,
    containerId: string,
    creds: Buffer,
  ): Promise<void> {
    const adapter = this.runtimes.get(instance.runtimeKind);
    let linked = false;
    try {
      await adapter.injectWhatsappSession(containerId, creds);
      const started = await adapter.startWhatsappChannel(containerId);
      if (started.status === "started") {
        linked = await this.waitForLink(instance);
      } else {
        this.logger.warn(
          { instanceId: instance.id, reason: started.reason },
          "whatsapp channel start unavailable; restarting container",
        );
      }
      if (!linked) {
        await this.eventLog.append(instance.id, "pair.restart_fallback", {
          payload: { reason: started.status === "started" ? "link_timeout" : started.reason },
        });
        await adapter.writeConfig(containerId, instance);
        await this.runtime.restart(containerId);
        linked = await this.waitForLink(instance);
      }
    } catch (err) {
      this.logger.error(
        { instanceId: instance.id, err: errorMessage(err) },
        "failed to activate whatsapp in main container",
      );
      await this.eventLog.append(instance.id, "pair.inject_failed", {
        payload: { error: errorMessage(err) },
      });
      return;
    }

    const helloSent = linked ? await this.sendHello(instance, containerId) : false;
    await this.eventLog.append(instance.id, READY_EVENT, {
      payload: { linked, helloSent },
    });
  }

  private async waitForLink(instance: Instance): Promise<boolean> {
    const adapter = this.runtimes.get(instance.runtimeKind);
    const deadline = Date.now() + LINK_WAIT_MS;
    while (Date.now() < deadline) {
      const state = await adapter
        .probeWhatsapp(instance, LINK_PROBE_TIMEOUT_MS, this.pairing.useDockerNetwork)
        .catch(() => "probe_failed" as const);
      if (state === "connected") return true;
      await sleep(LINK_POLL_MS);
    }
    return false;
  }

  // The owner is told the bot is live by the bot itself; without a known owner number there is
  // nobody to tell, and the dashboard says so instead.
  private async sendHello(instance: Instance, containerId: string): Promise<boolean> {
    const ownerNumber = findWhatsappChannel(instance.config.channels)?.ownerNumber;
    if (!ownerNumber) return false;
    const adapter = this.runtimes.get(instance.runtimeKind);
    const text = helloMessage(instance.displayName);
    for (let attempt = 1; attempt <= HELLO_ATTEMPTS; attempt++) {
      try {
        if (await adapter.sendWhatsappMessage(containerId, ownerNumber, text)) return true;
      } catch (err) {
        this.logger.warn(
          { instanceId: instance.id, attempt, err: errorMessage(err) },
          "whatsapp hello failed",
        );
      }
      if (attempt < HELLO_ATTEMPTS) await sleep(HELLO_RETRY_MS);
    }
    await this.eventLog.append(instance.id, "pair.hello_failed");
    return false;
  }

  async cancelPairing(instanceId: string, reason: string): Promise<void> {
    const updated = await this.repo.updatePairing(
      instanceId,
      { pairingStatus: "failed" },
      { expectedPairingStatus: ["awaiting_qr", "awaiting_code"] },
    );
    if (!updated) return;
    await this.eventLog.append(instanceId, "pair.cancelled", {
      payload: { reason },
    });
    await this.teardownSidecar(instanceId, reason);
  }

  async expireStale(olderThanMs: number): Promise<void> {
    const stale = await this.repo.findStalePairings(olderThanMs);
    for (const inst of stale) {
      this.logger.warn({ instanceId: inst.id }, "expiring stale pairing");
      const updated = await this.repo.updatePairing(
        inst.id,
        { pairingStatus: "expired" },
        { expectedPairingStatus: ["awaiting_qr", "awaiting_code"] },
      );
      if (!updated) continue;
      await this.eventLog.append(inst.id, "pair.timeout");
      await this.teardownSidecar(inst.id, "expired");
    }
  }

  private async reclaimMissingSession(instance: Instance): Promise<boolean> {
    if (!["awaiting_qr", "awaiting_code"].includes(instance.pairingStatus)) {
      return false;
    }
    if (this.sessions.has(instance.id)) return false;

    const shortId = instance.id.slice(0, 12);
    const sidecarId = await this.runtime.findContainerByName(`pairing-${shortId}`);
    if (sidecarId && (await this.runtime.isRunning(sidecarId))) {
      return false;
    }

    return this.repo.updatePairing(
      instance.id,
      { pairingStatus: "failed" },
      { expectedPairingStatus: ["awaiting_qr", "awaiting_code"] },
    );
  }

  // Falls back to deterministic name if no in-memory session (post-restart).
  // Drops the session only AFTER removal succeeds so a transient Docker error
  // doesn't strand a live Baileys socket we can no longer name.
  async teardownSidecar(instanceId: string, reason: string): Promise<void> {
    const session = this.sessions.get(instanceId);
    let containerId = session?.sidecarContainerId ?? null;
    if (!containerId) {
      const shortId = instanceId.slice(0, 12);
      containerId = await this.runtime.findContainerByName(`pairing-${shortId}`);
    }
    if (!containerId) {
      this.sessions.delete(instanceId);
      return;
    }

    try {
      await this.runtime.remove(containerId);
      this.sessions.delete(instanceId);
      this.logger.info({ instanceId, reason }, "sidecar torn down");
    } catch (err) {
      this.logger.warn(
        { instanceId, err: errorMessage(err) },
        "failed to remove sidecar container",
      );
    }
  }

}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
