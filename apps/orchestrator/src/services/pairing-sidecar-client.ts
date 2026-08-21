import type { FastifyBaseLogger } from "fastify";
import type { PairingConfig } from "../config.js";
import { UpstreamUnavailableError, errorMessage } from "../domain/errors.js";
import type { PairingSessionRegistry } from "./pairing-session-registry.js";

export class PairingSidecarClient {
  constructor(
    private readonly sessions: PairingSessionRegistry,
    private readonly pairing: PairingConfig,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async proxy(
    instanceId: string,
    path: string,
    init: { method: string; body?: unknown; headers?: Record<string, string> },
  ): Promise<{ status: number; body: unknown }> {
    const session = this.sessions.get(instanceId);
    if (!session) {
      return {
        status: 425,
        body: {
          code: "PAIRING_NOT_STARTED",
          message: "pairing has not started",
        },
      };
    }

    const url = session.sidecarHostPort
      ? `http://127.0.0.1:${session.sidecarHostPort}${path}`
      : `http://${session.sidecarContainerName}:${this.pairing.port}${path}`;
    const headers: Record<string, string> = {
      authorization: `Bearer ${session.authToken}`,
      ...(init.headers ?? {}),
    };

    let body: BodyInit | undefined;
    if (init.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.body);
    }

    const res = await this.fetch(url, {
      method: init.method,
      headers,
      body,
    });

    return { status: res.status, body: await parseResponse(res) };
  }

  private async fetch(
    url: string,
    opts: {
      method: string;
      headers: Record<string, string>;
      body: BodyInit | undefined;
    },
  ): Promise<Response> {
    const maxAttempts = opts.method === "GET" ? 3 : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const res = await fetch(url, {
          method: opts.method,
          headers: opts.headers,
          body: opts.body,
          signal: AbortSignal.timeout(this.pairing.requestTimeoutMs),
        });
        if (!isTransient(res.status) || attempt === maxAttempts) return res;
        await res.text().catch(() => undefined);
        lastError = new Error(`sidecar returned ${res.status}`);
      } catch (err) {
        lastError = err;
        if (attempt === maxAttempts) break;
      }
      await sleep(150 * 2 ** (attempt - 1));
    }

    this.logger.warn({ err: errorMessage(lastError) }, "sidecar request failed");
    throw new UpstreamUnavailableError("pairing sidecar");
  }
}

async function parseResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
}

function isTransient(status: number): boolean {
  return status === 429 || status === 503;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
