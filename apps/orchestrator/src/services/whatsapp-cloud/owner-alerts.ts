import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { errorMessage } from "../../domain/errors.js";
import type { OwnerRoute } from "../../domain/owner.js";
import type { OwnerTurnDelivery } from "../agent-runtime/types.js";
import type { Instance } from "../../domain/types.js";
import { BackgroundTasks } from "../background-tasks.js";
import type { HostRuntimes } from "../host-runtimes.js";

const POLL_INTERVAL_MS = 5_000;
// Covers a wait behind a turn the owner already has running, plus the model reading the conversation.
const DELIVERY_DEADLINE_MS = 3 * 60_000;

export interface OwnerAlerts {
  // True once the owner's agent took the alert; `fallback` then runs only if the agent's message never reaches the owner.
  start(inst: Instance, route: OwnerRoute, waId: string, fallback: () => Promise<void>): Promise<boolean>;
}

export class AgentOwnerAlerts implements OwnerAlerts {
  private readonly tasks: BackgroundTasks;

  constructor(
    private readonly hosts: HostRuntimes,
    private readonly log: FastifyBaseLogger,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    private readonly now: () => number = () => Date.now(),
  ) {
    this.tasks = new BackgroundTasks(log, "customer alert watch failed unexpectedly");
  }

  async start(inst: Instance, route: OwnerRoute, waId: string, fallback: () => Promise<void>): Promise<boolean> {
    const containerId = inst.containerId;
    if (!containerId) return false;
    try {
      const adapter = this.hosts.for(inst.hostId).adapters.get(inst.runtimeKind);
      const alertId = await adapter.startCustomerAlert(containerId, route, { key: randomUUID(), waId });
      if (!alertId) return false;
      this.tasks.launch(
        this.watch(
          inst.id,
          () => adapter.customerAlertDelivery(containerId, alertId),
          () => adapter.cancelCustomerAlert(containerId, alertId),
          fallback,
        ),
      );
      return true;
    } catch (err) {
      this.log.warn({ instanceId: inst.id, err: errorMessage(err) }, "customer alert not started");
      return false;
    }
  }

  settle(timeoutMs?: number): Promise<void> {
    return this.tasks.settle(timeoutMs);
  }

  private async watch(
    instanceId: string,
    delivery: () => Promise<OwnerTurnDelivery>,
    cancel: () => Promise<void>,
    fallback: () => Promise<void>,
  ): Promise<void> {
    const deadline = this.now() + DELIVERY_DEADLINE_MS;
    let outcome: OwnerTurnDelivery = "pending";
    while (outcome === "pending" && this.now() < deadline) {
      await this.sleep(POLL_INTERVAL_MS);
      outcome = await delivery();
    }
    // Also after a delivery: a run that errored after delivering would otherwise be retried and alert again.
    await cancel().catch((err: unknown) => this.log.warn({ instanceId, err: errorMessage(err) }, "customer alert not cancelled"));
    if (outcome === "delivered") return;
    this.log.warn({ instanceId }, "customer alert not delivered by the owner's agent; sending it directly");
    await fallback().catch((err: unknown) => this.log.warn({ instanceId, err: errorMessage(err) }, "customer alert fallback failed"));
  }
}
