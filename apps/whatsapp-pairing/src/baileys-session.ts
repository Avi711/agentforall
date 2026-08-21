import { EventEmitter } from "node:events";
import { mkdir } from "node:fs/promises";
import type { FastifyBaseLogger } from "fastify";
import {
  makeWASocket,
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  useMultiFileAuthState,
  type WASocket,
} from "baileys";
import { Boom } from "@hapi/boom";

export type PairingPhase =
  | "idle"
  | "awaiting_qr"
  | "awaiting_code"
  | "authenticating"
  | "authenticated"
  | "failed";

export interface PairingState {
  phase: PairingPhase;
  qr: string | undefined;
  qrExpiresAt: Date | undefined;
  pairingCode: string | undefined;
  pairingCodeExpiresAt: Date | undefined;
  accountId: string | undefined;
  reason: string | undefined;
  updatedAt: Date;
}

const QR_TTL_MS = 60_000;
const PAIRING_CODE_TTL_MS = 2 * 60_000;

// Emits `state` on every transition, `authenticated` AFTER the final saveCreds
// flush (so callers tarring sessionDir see fully-flushed state), `failed` once.
export class BaileysSession extends EventEmitter {
  private sock: WASocket | undefined;
  private state: PairingState;
  private startPromise: Promise<void> | undefined;
  // Awaited on `connection: open` so the tar sees every creds.update that fired during pair.
  private pendingSaves: Promise<void> = Promise.resolve();
  private authenticatedEmitted = false;
  // Baileys closes on transient errors and expects the consumer to rebuild the socket.
  private reconnectAttempts = 0;
  private static readonly MAX_RECONNECTS = 5;

  constructor(
    private readonly sessionDir: string,
    private readonly log: FastifyBaseLogger,
  ) {
    super();
    // EventEmitter without an 'error' listener crashes Node — defensive.
    this.on("error", (err) => this.log.error({ err }, "session emitter error"));
    this.state = {
      phase: "idle",
      qr: undefined,
      qrExpiresAt: undefined,
      pairingCode: undefined,
      pairingCodeExpiresAt: undefined,
      accountId: undefined,
      reason: undefined,
      updatedAt: new Date(),
    };
  }

  getState(): PairingState {
    return { ...this.state };
  }

  async start(): Promise<void> {
    if (!this.startPromise) this.startPromise = this.connect();
    return this.startPromise;
  }

  async requestPairingCode(phoneNumber: string): Promise<string> {
    await this.start();
    if (!this.sock) {
      throw new Error("socket not initialized");
    }
    if (this.state.phase === "authenticated") {
      throw new Error("already authenticated");
    }
    const normalized = normalizePhoneE164(phoneNumber);
    const code = await this.sock.requestPairingCode(normalized);
    const formatted = formatPairingCode(code);
    this.transition({
      phase: "awaiting_code",
      pairingCode: formatted,
      pairingCodeExpiresAt: new Date(Date.now() + PAIRING_CODE_TTL_MS),
    });
    return formatted;
  }

  async shutdown(): Promise<void> {
    await this.pendingSaves.catch(() => undefined);
    try {
      this.sock?.end(undefined);
    } catch (err) {
      this.log.warn({ err }, "error ending socket");
    }
  }

  private async connect(): Promise<void> {
    await mkdir(this.sessionDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);

    // Fetch live version — Baileys' pinned version drifts and gets 405'd on protocol bumps.
    const { version } = await fetchLatestBaileysVersion();
    this.log.info({ version }, "using WhatsApp Web version");

    this.sock = makeWASocket({
      auth: state,
      browser: Browsers.ubuntu("Agent For All"),
      version,
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      logger: this.log.child({ component: "baileys" }),
    });

    // Serialize so all are awaited on `open`.
    this.sock.ev.on("creds.update", () => {
      this.pendingSaves = this.pendingSaves
        .then(() => saveCreds())
        .catch((err) => this.log.error({ err }, "saveCreds failed"));
    });

    this.sock.ev.on("connection.update", (update) => {
      this.handleConnectionUpdate(update).catch((err) =>
        this.log.error({ err }, "connection.update handler crashed"),
      );
    });
  }

  private async handleConnectionUpdate(update: {
    qr?: string;
    connection?: "connecting" | "open" | "close";
    lastDisconnect?: { error?: Error };
  }): Promise<void> {
    const { qr, connection, lastDisconnect } = update;

    if (qr) {
      this.transition({
        phase: "awaiting_qr",
        qr,
        qrExpiresAt: new Date(Date.now() + QR_TTL_MS),
      });
    }
    if (connection === "connecting" && this.state.phase === "idle") {
      this.transition({ phase: "authenticating" });
    }
    if (connection === "open") {
      this.reconnectAttempts = 0; // recovery worked — reset budget for future transients
      // Flush before signalling authenticated, else the tar misses the last creds.update.
      await this.pendingSaves.catch(() => undefined);
      if (this.authenticatedEmitted) return;
      this.authenticatedEmitted = true;

      const meId = this.sock?.user?.id;
      const accountId = meId ? extractAccountNumber(meId) : undefined;
      this.transition({
        phase: "authenticated",
        accountId,
        qr: undefined,
        pairingCode: undefined,
      });
      this.emit("authenticated", { accountId });
    }
    if (connection === "close") {
      const statusCode =
        lastDisconnect?.error instanceof Boom
          ? lastDisconnect.error.output.statusCode
          : undefined;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      const reason = describeDisconnect(statusCode, lastDisconnect?.error);
      this.log.info({ statusCode, reason, isLoggedOut }, "connection closed");

      // Post-auth: any close is terminal — consumer already got creds. Logged-out: always terminal.
      if (this.state.phase === "authenticated" || isLoggedOut) {
        if (this.state.phase === "failed") return;
        this.transition({ phase: "failed", reason });
        this.emit("failed", { reason });
        return;
      }

      // Pre-auth `restart_required` (515) fires post-handshake; protocol expects
      // a reconnect with saved creds. Treating as terminal strands the user.
      if (this.reconnectAttempts >= BaileysSession.MAX_RECONNECTS) {
        this.log.error({ reason, attempts: this.reconnectAttempts }, "giving up on reconnect");
        this.transition({ phase: "failed", reason });
        this.emit("failed", { reason });
        return;
      }
      this.reconnectAttempts += 1;
      this.log.info(
        { reason, attempt: this.reconnectAttempts },
        "reconnecting after transient close",
      );
      await this.pendingSaves.catch(() => undefined);
      this.sock = undefined;
      void this.connect().catch((err) =>
        this.log.error({ err }, "reconnect failed"),
      );
    }
  }

  private transition(patch: Partial<PairingState>): void {
    this.state = {
      ...this.state,
      ...patch,
      updatedAt: new Date(),
    };
    this.emit("state", this.state);
  }
}

function extractAccountNumber(jid: string): string | undefined {
  try {
    const normalized = jidNormalizedUser(jid);
    const at = normalized.indexOf("@");
    const local = at >= 0 ? normalized.slice(0, at) : normalized;
    const colon = local.indexOf(":"); // strip legacy `:<device>` suffix

    return colon >= 0 ? local.slice(0, colon) : local;
  } catch {
    // Malformed JID — caller treats undefined as "no account id".
    return undefined;
  }
}

// Baileys requires E.164 without the leading `+`; reject local format up-front.
function normalizePhoneE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) {
    throw new Error("phone too short — include country code (e.g. 972…)");
  }
  if (digits.length > 15) {
    throw new Error("phone too long — max 15 digits");
  }
  if (digits.startsWith("0")) {
    throw new Error("phone must start with country code, not a leading 0");
  }
  return digits;
}

function formatPairingCode(raw: string): string {
  const chars = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (chars.length !== 8) return chars;
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

function describeDisconnect(
  statusCode: number | undefined,
  err: Error | undefined,
): string {
  if (statusCode === DisconnectReason.loggedOut) return "logged_out";
  if (statusCode === DisconnectReason.connectionClosed) return "connection_closed";
  if (statusCode === DisconnectReason.connectionLost) return "connection_lost";
  if (statusCode === DisconnectReason.connectionReplaced) return "connection_replaced";
  if (statusCode === DisconnectReason.restartRequired) return "restart_required";
  if (statusCode === DisconnectReason.timedOut) return "timed_out";
  if (statusCode === DisconnectReason.badSession) return "bad_session";
  if (err?.message) return err.message;
  return "unknown";
}
