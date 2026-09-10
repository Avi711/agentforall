import { createHash, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import { WHATSAPP_CLOUD_OWNER_ECHO_KIND, WHATSAPP_CLOUD_PARTNER_REMOVED_KIND } from "@agent-forall/db";
import { verifyBodySignature } from "../billing/provider/hmac";
import type { WhatsappCloudIngressStore, InboundRow } from "./repository";
import {
  ACCOUNT_UPDATE_FIELD,
  AccountUpdateSchema,
  ContactSchema,
  InboundMessageSchema,
  MESSAGES_FIELD,
  OWNER_ECHOES_FIELD,
  OwnerEchoSchema,
  PARTNER_REMOVED_EVENT,
  WebhookChangeValueSchema,
  WebhookEnvelopeSchema,
  WebhookVerifyQuerySchema,
  type InboundMessage,
  type OwnerEcho,
} from "./schemas";

export class IngressError extends Error {
  constructor(
    readonly code: "invalid_signature" | "invalid_payload" | "verify_token_mismatch",
    readonly status: number,
  ) {
    super(code);
    this.name = "IngressError";
  }
}

export interface IngressOutcome {
  received: number;
  enqueued: number;
  unknownNumbers: number;
  rejected: number;
}

export interface WebhookRequest {
  rawBody: string;
  signature: string | null;
}

const SIGNATURE_PREFIX = "sha256=";

// Verifies, routes by phone_number_id and stores; never talks to an orchestrator; fields it does not use are acked and ignored.
export class WhatsappCloudIngress {
  constructor(
    private readonly store: WhatsappCloudIngressStore,
    private readonly appSecret: string,
    private readonly verifyToken: string,
    private readonly log: Pick<Console, "warn"> = console,
    private readonly now: () => Date = () => new Date(),
  ) {}

  verifyChallenge(query: URLSearchParams): string {
    const parsed = WebhookVerifyQuerySchema.safeParse(Object.fromEntries(query));
    if (!parsed.success) throw new IngressError("invalid_payload", 400);
    if (!secretsMatch(parsed.data["hub.verify_token"], this.verifyToken)) throw new IngressError("verify_token_mismatch", 403);
    return parsed.data["hub.challenge"];
  }

  async handle(req: WebhookRequest): Promise<IngressOutcome> {
    if (!this.signatureMatches(req)) throw new IngressError("invalid_signature", 401);

    let json: unknown;
    try {
      // Postgres jsonb rejects U+0000; one such character in one message must not fail the whole batch.
      json = JSON.parse(req.rawBody, (_key, value: unknown) => (typeof value === "string" ? value.replace(/\u0000/g, "") : value));
    } catch {
      throw new IngressError("invalid_payload", 400);
    }
    const envelope = WebhookEnvelopeSchema.safeParse(json);
    if (!envelope.success) throw new IngressError("invalid_payload", 400);

    const rows: InboundRow[] = [];
    const receivedAt = this.now();
    const tally = { received: 0, unknownNumbers: 0, rejected: 0 };
    const instanceByNumber = new Map<string, string | null>();
    const route = async (phoneNumberId: string, count: number): Promise<string | null> => {
      let instanceId = instanceByNumber.get(phoneNumberId);
      if (instanceId === undefined) {
        instanceId = await this.store.findInstanceIdByPhoneNumberId(phoneNumberId);
        instanceByNumber.set(phoneNumberId, instanceId);
      }
      if (instanceId === null) {
        tally.unknownNumbers += count;
        this.log.warn(`whatsapp cloud webhook for unknown phone_number_id ${phoneNumberId}`);
      }
      return instanceId;
    };

    for (const entry of envelope.data.entry) {
      for (const change of entry.changes) {
        if (change.field === ACCOUNT_UPDATE_FIELD) {
          rows.push(...(await this.partnerRemovals(entry, change.value, receivedAt)));
          continue;
        }
        if (change.field !== MESSAGES_FIELD && change.field !== OWNER_ECHOES_FIELD) continue;
        const value = WebhookChangeValueSchema.safeParse(change.value);
        if (!value.success) {
          tally.rejected += 1;
          this.log.warn(`whatsapp cloud webhook change for entry ${entry.id} rejected: ${value.error.issues.length} issue(s)`);
          continue;
        }
        const phoneNumberId = value.data.metadata.phone_number_id;

        if (change.field === OWNER_ECHOES_FIELD) {
          const echoes = this.accepted(value.data.message_echoes, OwnerEchoSchema, `owner echo in entry ${entry.id}`, tally);
          if (echoes.length === 0) continue;
          tally.received += echoes.length;
          const instanceId = await route(phoneNumberId, echoes.length);
          if (instanceId === null) continue;
          for (const echo of echoes) rows.push(toEchoRow(instanceId, echo, receivedAt));
          continue;
        }

        const messages = this.accepted(value.data.messages, InboundMessageSchema, `message in entry ${entry.id}`, tally);
        if (messages.length === 0) continue;
        tally.received += messages.length;
        const instanceId = await route(phoneNumberId, messages.length);
        if (instanceId === null) continue;
        const names = new Map<string, string>();
        for (const raw of value.data.contacts ?? []) {
          const contact = ContactSchema.safeParse(raw);
          if (contact.success && contact.data.profile?.name) names.set(contact.data.wa_id, contact.data.profile.name);
        }
        for (const message of messages) rows.push(toRow(instanceId, message, names.get(message.from) ?? null, receivedAt));
      }
    }

    const enqueued = await this.store.enqueue(rows);
    return { received: tally.received, enqueued, unknownNumbers: tally.unknownNumbers, rejected: tally.rejected };
  }

  // One odd item is skipped and counted while the rest of its batch lands; only the count is logged, never the content.
  private accepted<T>(raw: unknown[] | undefined, schema: z.ZodType<T>, what: string, tally: { rejected: number }): T[] {
    const out: T[] = [];
    for (const item of raw ?? []) {
      const parsed = schema.safeParse(item);
      if (parsed.success) out.push(parsed.data);
      else {
        tally.rejected += 1;
        this.log.warn(`whatsapp cloud ${what} rejected: ${parsed.error.issues.length} issue(s)`);
      }
    }
    return out;
  }

  // A business removed our app inside WhatsApp Business: every bot on that account is told, through the inbox like any row.
  private async partnerRemovals(entry: { id: string; time?: number }, value: unknown, receivedAt: Date): Promise<InboundRow[]> {
    const update = AccountUpdateSchema.safeParse(value);
    if (!update.success || update.data.event !== PARTNER_REMOVED_EVENT) return [];
    const wabaId = update.data.waba_info?.waba_id;
    this.log.warn(`whatsapp cloud ${PARTNER_REMOVED_EVENT} for waba ${wabaId ?? "unknown"}`);
    if (!wabaId) return [];
    // The same webhook resent by Meta gives the same ids, so the inbox's unique wamid drops the repeat.
    const digest = createHash("sha256").update(`${entry.id}:${entry.time ?? ""}:${JSON.stringify(value)}`).digest("hex").slice(0, 32);
    const instanceIds = await this.store.findInstanceIdsByWabaId(wabaId);
    return instanceIds.map((instanceId) => ({
      kind: WHATSAPP_CLOUD_PARTNER_REMOVED_KIND,
      wamid: `partner_removed:${instanceId}:${digest}`,
      instanceId,
      waId: null,
      profileName: null,
      waTimestamp: receivedAt,
      receivedAt,
      payload: { kind: WHATSAPP_CLOUD_PARTNER_REMOVED_KIND, wabaId },
    }));
  }

  private signatureMatches(req: WebhookRequest): boolean {
    if (!req.signature?.startsWith(SIGNATURE_PREFIX)) return false;
    return verifyBodySignature(this.appSecret, req.rawBody, req.signature.slice(SIGNATURE_PREFIX.length));
  }
}

// wa_timestamp is the customer's clock and only orders messages; the 24h window runs from our receipt, like Meta's.
function toRow(instanceId: string, message: InboundMessage, profileName: string | null, receivedAt: Date): InboundRow {
  return {
    kind: "message",
    wamid: message.id,
    instanceId,
    waId: message.from,
    profileName,
    waTimestamp: new Date(Number(message.timestamp) * 1000),
    receivedAt,
    payload: { from: message.from, profileName, message },
  };
}

// Only who was answered is kept: the owner's own text is not ours to store.
function toEchoRow(instanceId: string, echo: OwnerEcho, receivedAt: Date): InboundRow {
  return {
    kind: WHATSAPP_CLOUD_OWNER_ECHO_KIND,
    wamid: echo.id,
    instanceId,
    waId: echo.to,
    profileName: null,
    waTimestamp: new Date(Number(echo.timestamp) * 1000),
    receivedAt,
    payload: { kind: WHATSAPP_CLOUD_OWNER_ECHO_KIND, to: echo.to },
  };
}

function secretsMatch(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
