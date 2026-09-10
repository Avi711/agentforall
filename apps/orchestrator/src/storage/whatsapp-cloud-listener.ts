import { Client } from "pg";
import type { FastifyBaseLogger } from "fastify";
import { WHATSAPP_CLOUD_INBOX_CHANNEL } from "@agent-forall/db";
import { errorMessage } from "../domain/errors.js";

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
// A connection that held for this long earns the short backoff again; one that keeps dying does not.
const STABLE_AFTER_MS = 30_000;

export interface ListenClient {
  connect(): Promise<unknown>;
  query(text: string): Promise<unknown>;
  end(): Promise<void>;
  on(event: "notification", listener: (msg: { channel: string; payload?: string }) => void): unknown;
  on(event: "error" | "end", listener: (err?: Error) => void): unknown;
}

export type ListenClientFactory = () => ListenClient;

// One dedicated session connection that LISTENs for inbox inserts; the poll is the fallback, so a drop costs latency only.
export class WhatsappCloudInboxListener {
  private client: ListenClient | null = null;
  private connecting = false;
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private backoffMs = RECONNECT_MIN_MS;
  private connectedAt = 0;

  constructor(
    private readonly onWake: (instanceId: string) => void,
    private readonly log: FastifyBaseLogger,
    private readonly clientFactory: ListenClientFactory,
    private readonly now: () => number = Date.now,
  ) {}

  static forUrl(connectionString: string, onWake: (instanceId: string) => void, log: FastifyBaseLogger): WhatsappCloudInboxListener {
    return new WhatsappCloudInboxListener(onWake, log, () => new Client({ connectionString, keepAlive: true }));
  }

  async start(): Promise<void> {
    this.stopped = false;
    if (this.client || this.connecting) return;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const client = this.client;
    this.client = null;
    if (client) await this.close(client);
  }

  get connected(): boolean {
    return this.client !== null;
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.connecting) return;
    this.connecting = true;
    const client = this.clientFactory();
    client.on("notification", (msg) => {
      if (msg.channel === WHATSAPP_CLOUD_INBOX_CHANNEL && msg.payload) this.onWake(msg.payload);
    });
    client.on("error", (err) => this.dropped(client, err));
    client.on("end", () => this.dropped(client));
    try {
      await client.connect();
      // Raw SQL by necessity: LISTEN has no builder form; the channel name is our own constant.
      await client.query(`LISTEN ${WHATSAPP_CLOUD_INBOX_CHANNEL}`);
    } catch (err) {
      this.connecting = false;
      this.log.warn({ err: errorMessage(err) }, "whatsapp cloud inbox listener connect failed");
      await this.close(client);
      this.scheduleReconnect();
      return;
    }
    this.connecting = false;
    if (this.stopped) {
      await this.close(client);
      return;
    }
    this.client = client;
    this.connectedAt = this.now();
    this.log.info("whatsapp cloud inbox listener connected");
  }

  private dropped(client: ListenClient, err?: Error): void {
    if (this.client !== client) return;
    this.client = null;
    void this.close(client);
    if (this.stopped) return;
    if (this.now() - this.connectedAt >= STABLE_AFTER_MS) this.backoffMs = RECONNECT_MIN_MS;
    this.log.warn({ err: err ? errorMessage(err) : "connection ended" }, "whatsapp cloud inbox listener dropped");
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref();
  }

  private async close(client: ListenClient): Promise<void> {
    try {
      await client.end();
    } catch (err) {
      this.log.warn({ err: errorMessage(err) }, "whatsapp cloud inbox listener close failed");
    }
  }
}
