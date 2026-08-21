import type { FastifyBaseLogger } from "fastify";
import type { BotUsage, Instance } from "../domain/types.js";
import type { InstanceRepository } from "../storage/instance-repository.js";
import type { LlmKeyProvisioner } from "./litellm-key-manager.js";

export interface AdminInstanceOverview {
  instance: Instance;
  // null = the LiteLLM lookup failed for this bot; the rest of the overview still renders.
  usage: BotUsage | null;
}

// LiteLLM is a single Cloud Run instance; a burst of one call per bot would throttle it.
const USAGE_CONCURRENCY = 4;

export class AdminOverviewService {
  constructor(
    private readonly repo: Pick<InstanceRepository, "findAllActive">,
    private readonly llmKeys: Pick<LlmKeyProvisioner, "getBotUsage">,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async listInstances(): Promise<AdminInstanceOverview[]> {
    const all = await this.repo.findAllActive();
    return mapWithConcurrency(all, USAGE_CONCURRENCY, async (instance) => ({
      instance,
      usage: await this.usageOf(instance),
    }));
  }

  private async usageOf(inst: Instance): Promise<BotUsage | null> {
    try {
      return await this.llmKeys.getBotUsage(inst);
    } catch (err) {
      this.logger.warn({ instanceId: inst.id, err }, "admin usage lookup failed");
      return null;
    }
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  const queue = items.entries();
  const worker = async () => {
    for (const [index, item] of queue) results[index] = await fn(item);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
