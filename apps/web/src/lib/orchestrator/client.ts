import "server-only";
import { z } from "zod";
import {
  InstanceSchema,
  StartPairingResultSchema,
  PairQrSchema,
  PairCodeSchema,
  PairStatusSchema,
  type Instance,
  type StartPairingResult,
  type PairQr,
  type PairCode,
  type PairStatus,
  type CreateInstanceInput,
} from "./types";

export class OrchestratorError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "OrchestratorError";
  }

  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

interface EnvConfig {
  baseUrl: string;
  serviceToken: string;
  requestTimeoutMs: number;
}

function readEnvConfig(): EnvConfig {
  const baseUrl = process.env.ORCHESTRATOR_BASE_URL;
  const serviceToken = process.env.ORCHESTRATOR_SERVICE_TOKEN;

  if (!baseUrl) throw new Error("ORCHESTRATOR_BASE_URL is not set");
  if (!serviceToken) throw new Error("ORCHESTRATOR_SERVICE_TOKEN is not set");

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    serviceToken,
    requestTimeoutMs: 10_000,
  };
}

export class OrchestratorClient {
  constructor(private readonly env = readEnvConfig()) {}

  async createBot(userId: string, input: CreateInstanceInput): Promise<Instance> {
    const body = {
      displayName: input.displayName,
      channels: [{ type: "whatsapp" }],
    };
    return this.call({
      method: "POST",
      path: "/api/v1/instances",
      userId,
      body,
      schema: InstanceSchema,
    });
  }

  async listBots(userId: string): Promise<Instance[]> {
    const ListBotsSchema = z.object({
      data: z.array(InstanceSchema),
      cursor: z.string().optional(),
    });
    const result = await this.call({
      method: "GET",
      path: "/api/v1/instances",
      userId,
      schema: ListBotsSchema,
    });
    return result.data;
  }

  // "destroyed" and "error" are tombstones; anything else is fair game.
  async findActiveBot(userId: string): Promise<Instance | null> {
    const bots = await this.listBots(userId);
    return bots.find((b) => b.status !== "destroyed" && b.status !== "error") ?? null;
  }

  async getBot(userId: string, id: string): Promise<Instance> {
    return this.call({
      method: "GET",
      path: `/api/v1/instances/${id}`,
      userId,
      schema: InstanceSchema,
    });
  }

  async deleteBot(userId: string, id: string): Promise<void> {
    await this.call({
      method: "DELETE",
      path: `/api/v1/instances/${id}`,
      userId,
      schema: z.unknown(),
      allowEmptyBody: true,
    });
  }

  async startPairing(userId: string, id: string): Promise<StartPairingResult> {
    return this.call({
      method: "POST",
      path: `/api/v1/instances/${id}/pair`,
      userId,
      schema: StartPairingResultSchema,
    });
  }

  async cancelPairing(userId: string, id: string): Promise<void> {
    await this.call({
      method: "POST",
      path: `/api/v1/instances/${id}/pair/cancel`,
      userId,
      schema: z.unknown(),
      allowEmptyBody: true,
    });
  }

  async getPairQr(userId: string, id: string): Promise<PairQr> {
    return this.call({
      method: "GET",
      path: `/api/v1/instances/${id}/pair/qr`,
      userId,
      schema: PairQrSchema,
    });
  }

  async requestPairCode(
    userId: string,
    id: string,
    phone: string,
  ): Promise<PairCode> {
    return this.call({
      method: "POST",
      path: `/api/v1/instances/${id}/pair/code`,
      userId,
      body: { phone },
      schema: PairCodeSchema,
    });
  }

  async getPairStatus(userId: string, id: string): Promise<PairStatus> {
    return this.call({
      method: "GET",
      path: `/api/v1/instances/${id}/pair/status`,
      userId,
      schema: PairStatusSchema,
    });
  }

  private async call<T>(opts: {
    method: "GET" | "POST" | "DELETE" | "PATCH";
    path: string;
    userId: string;
    body?: unknown;
    schema: z.ZodType<T>;
    allowEmptyBody?: boolean;
  }): Promise<T> {
    const url = `${this.env.baseUrl}${opts.path}`;
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.env.serviceToken}`,
      "x-act-as-user": opts.userId,
    };
    let body: BodyInit | undefined;
    if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.body);
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method,
        headers,
        body,
        signal: AbortSignal.timeout(this.env.requestTimeoutMs),
        cache: "no-store",
      });
    } catch (err) {
      throw new OrchestratorError(
        `orchestrator request failed: ${err instanceof Error ? err.message : "unknown"}`,
        0,
      );
    }

    if (res.status === 204) {
      if (opts.allowEmptyBody) return opts.schema.parse(undefined);
      throw new OrchestratorError("unexpected 204", res.status);
    }

    const text = await res.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new OrchestratorError("non-JSON response from orchestrator", res.status, text);
      }
    }

    if (!res.ok) {
      throw new OrchestratorError(
        `orchestrator returned ${res.status}`,
        res.status,
        parsed,
      );
    }

    const result = opts.schema.safeParse(parsed);
    if (!result.success) {
      throw new OrchestratorError(
        `orchestrator response failed schema validation: ${result.error.message}`,
        res.status,
        parsed,
      );
    }
    return result.data;
  }
}

let cached: OrchestratorClient | undefined;

export function getOrchestratorClient(): OrchestratorClient {
  if (!cached) cached = new OrchestratorClient();
  return cached;
}
