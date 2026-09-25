import type { FastifyBaseLogger } from "fastify";

export interface InstanceEventLog {
  append(
    instanceId: string,
    eventType: string,
    opts?: { actor?: string; payload?: Record<string, unknown> },
  ): Promise<void>;
}

export class BackgroundTasks {
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly logger: FastifyBaseLogger,
    private readonly failureMessage: string,
  ) {}

  // Tasks catch their own errors; the guard keeps a future slip from turning settle() into a throw at shutdown.
  launch(task: Promise<void>): void {
    const guarded = task.catch((err: unknown) => {
      this.logger.error({ err }, this.failureMessage);
    });
    this.inFlight.add(guarded);
    void guarded.finally(() => this.inFlight.delete(guarded));
  }

  async settle(timeoutMs = Number.POSITIVE_INFINITY): Promise<void> {
    const all = Promise.all([...this.inFlight]).then(() => undefined);
    if (!Number.isFinite(timeoutMs)) return all;
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    try {
      await Promise.race([all, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }
}
