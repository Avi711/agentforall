import "server-only";
import { z } from "zod";
import {
  InstanceSchema,
  StartPairingResultSchema,
  PairQrSchema,
  PairCodeSchema,
  PairStatusSchema,
  BotUsageSchema,
  TelegramLinkSchema,
  TelegramLinkStatusSchema,
  WhatsappAccessSchema,
  type WhatsappAccess,
  type WhatsappAccessUpdate,
  OwnerIdentitySchema,
  type OwnerIdentity,
  type OwnerIdentityUpdate,
  type Instance,
  type StartPairingResult,
  type PairQr,
  type PairCode,
  type PairStatus,
  type BotUsage,
  type CreateInstanceInput,
  type TelegramLink,
  type TelegramLinkStatus,
} from "./types";

const BackupUploadSessionSchema = z.object({
  uploadUrl: z.string().url(),
  restoreToken: z.string().min(1),
  expiresAt: z.string(),
});
export type BackupUploadSession = z.infer<typeof BackupUploadSessionSchema>;

const BackupExportJobSchema = z.discriminatedUnion("status", [
  z.object({ id: z.string().uuid(), status: z.literal("pending") }),
  z.object({
    id: z.string().uuid(),
    status: z.literal("ready"),
    downloadUrl: z.string().url(),
  }),
  z.object({
    id: z.string().uuid(),
    status: z.literal("error"),
    message: z.string(),
  }),
]);
export type BackupExportJob = z.infer<typeof BackupExportJobSchema>;

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
      channels: [{ type: input.channel }],
    };
    return this.call({
      method: "POST",
      path: "/api/v1/instances",
      userId,
      body,
      schema: InstanceSchema,
      timeoutMs: 30_000,
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

  async getBot(userId: string, id: string): Promise<Instance> {
    return this.call({
      method: "GET",
      path: instancePath(id),
      userId,
      schema: InstanceSchema,
    });
  }

  async deleteBot(userId: string, id: string): Promise<void> {
    await this.call({
      method: "DELETE",
      path: instancePath(id),
      userId,
      schema: z.unknown(),
      allowEmptyBody: true,
      timeoutMs: 60_000,
    });
  }

  async restartBot(userId: string, id: string): Promise<void> {
    await this.call({
      method: "POST",
      path: instancePath(id, "/restart"),
      userId,
      schema: z.unknown(),
      allowEmptyBody: true,
      timeoutMs: 60_000,
    });
  }

  getBotUsage(userId: string, id: string): Promise<BotUsage> {
    return this.call({
      method: "GET",
      path: instancePath(id, "/usage"),
      userId,
      schema: BotUsageSchema,
    });
  }

  startBotBackupExport(userId: string, id: string): Promise<BackupExportJob> {
    return this.call({
      method: "POST",
      path: instancePath(id, "/exports"),
      userId,
      schema: BackupExportJobSchema,
      timeoutMs: 10_000,
    });
  }

  getBotBackupExport(
    userId: string,
    id: string,
    jobId: string,
  ): Promise<BackupExportJob> {
    return this.call({
      method: "GET",
      path: instancePath(id, `/exports/${encodeURIComponent(jobId)}`),
      userId,
      schema: BackupExportJobSchema,
      timeoutMs: 10_000,
    });
  }

  async createBackupUploadSession(
    userId: string,
    input: {
      displayName: string;
      contentLength: number;
      contentType?: string;
    },
  ): Promise<BackupUploadSession> {
    return this.call({
      method: "POST",
      path: "/api/v1/backup-imports",
      userId,
      body: input,
      schema: BackupUploadSessionSchema,
    });
  }

  async restoreBackupUpload(
    userId: string,
    restoreToken: string,
  ): Promise<Instance> {
    return this.call({
      method: "POST",
      path: "/api/v1/backup-imports/restore",
      userId,
      body: { restoreToken },
      schema: InstanceSchema,
      timeoutMs: 120_000,
    });
  }

  async startPairing(userId: string, id: string): Promise<StartPairingResult> {
    return this.call({
      method: "POST",
      path: instancePath(id, "/pair"),
      userId,
      schema: StartPairingResultSchema,
    });
  }

  async cancelPairing(userId: string, id: string): Promise<void> {
    await this.call({
      method: "POST",
      path: instancePath(id, "/pair/cancel"),
      userId,
      schema: z.unknown(),
      allowEmptyBody: true,
    });
  }

  async getPairQr(userId: string, id: string): Promise<PairQr> {
    return this.call({
      method: "GET",
      path: instancePath(id, "/pair/qr"),
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
      path: instancePath(id, "/pair/code"),
      userId,
      body: { phone },
      schema: PairCodeSchema,
    });
  }

  async startTelegramLink(userId: string, id: string): Promise<TelegramLink> {
    return this.call({
      method: "POST",
      path: instancePath(id, "/telegram/link"),
      userId,
      schema: TelegramLinkSchema,
    });
  }

  async getTelegramLinkStatus(
    userId: string,
    id: string,
  ): Promise<TelegramLinkStatus> {
    return this.call({
      method: "GET",
      path: instancePath(id, "/telegram/status"),
      userId,
      schema: TelegramLinkStatusSchema,
    });
  }

  async disconnectWhatsapp(userId: string, id: string): Promise<void> {
    await this.call({
      method: "POST",
      path: instancePath(id, "/whatsapp/disconnect"),
      userId,
      schema: z.unknown(),
      allowEmptyBody: true,
      timeoutMs: 60_000,
    });
  }

  async disconnectTelegram(userId: string, id: string): Promise<void> {
    await this.call({
      method: "POST",
      path: instancePath(id, "/telegram/disconnect"),
      userId,
      schema: z.unknown(),
      allowEmptyBody: true,
      timeoutMs: 60_000,
    });
  }

  async getWhatsappAccess(userId: string, id: string): Promise<WhatsappAccess> {
    return this.call({
      method: "GET",
      path: instancePath(id, "/whatsapp/access"),
      userId,
      schema: WhatsappAccessSchema,
    });
  }

  async updateWhatsappAccess(
    userId: string,
    id: string,
    patch: WhatsappAccessUpdate,
  ): Promise<WhatsappAccess> {
    return this.call({
      method: "PATCH",
      path: instancePath(id, "/whatsapp/access"),
      userId,
      body: patch,
      schema: WhatsappAccessSchema,
      // Config updates restart the container synchronously.
      timeoutMs: 60_000,
    });
  }

  async getOwnerIdentity(userId: string, id: string): Promise<OwnerIdentity> {
    return this.call({
      method: "GET",
      path: instancePath(id, "/owner"),
      userId,
      schema: OwnerIdentitySchema,
    });
  }

  async updateOwnerIdentity(
    userId: string,
    id: string,
    patch: OwnerIdentityUpdate,
  ): Promise<OwnerIdentity> {
    return this.call({
      method: "PATCH",
      path: instancePath(id, "/owner"),
      userId,
      body: patch,
      schema: OwnerIdentitySchema,
      // Config updates restart the container synchronously.
      timeoutMs: 60_000,
    });
  }

  async getPairStatus(userId: string, id: string): Promise<PairStatus> {
    return this.call({
      method: "GET",
      path: instancePath(id, "/pair/status"),
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
    timeoutMs?: number;
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

    const res = await this.fetchWithRetry(url, {
      method: opts.method,
      headers,
      body,
      timeoutMs: opts.timeoutMs ?? this.env.requestTimeoutMs,
    });

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

  private async fetchWithRetry(
    url: string,
    opts: {
      method: "GET" | "POST" | "DELETE" | "PATCH";
      headers: Record<string, string>;
      body: BodyInit | undefined;
      timeoutMs: number;
    },
  ): Promise<Response> {
    const maxAttempts = opts.method === "GET" || opts.method === "DELETE" ? 3 : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const res = await fetch(url, {
          method: opts.method,
          headers: opts.headers,
          body: opts.body,
          signal: AbortSignal.timeout(opts.timeoutMs),
          cache: "no-store",
        });
        if (!isTransient(res.status) || attempt === maxAttempts) return res;
        await res.text().catch(() => undefined);
        lastError = new Error(`orchestrator returned ${res.status}`);
      } catch (err) {
        lastError = err;
        if (attempt === maxAttempts) break;
      }
      await sleep(150 * 2 ** (attempt - 1));
    }

    throw new OrchestratorError(
      `orchestrator request failed: ${lastError instanceof Error ? lastError.message : "unknown"}`,
      0,
    );
  }

}

let cached: OrchestratorClient | undefined;

export function getOrchestratorClient(): OrchestratorClient {
  if (!cached) cached = new OrchestratorClient();
  return cached;
}

function instancePath(id: string, suffix = ""): string {
  return `/api/v1/instances/${encodeURIComponent(id)}${suffix}`;
}

function isTransient(status: number): boolean {
  return status === 429 || status === 503;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
