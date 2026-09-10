import { createHash, timingSafeEqual } from "node:crypto";
import { verifyBodySignature } from "../billing/provider/hmac";
import type { WhatsappCloudIngressStore, InboundRow } from "./repository";
import {
  ContactSchema,
  InboundMessageSchema,
  MESSAGES_FIELD,
  WebhookChangeValueSchema,
  WebhookEnvelopeSchema,
  WebhookVerifyQuerySchema,
  type InboundMessage,
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

// Verifies, routes by phone_number_id and stores; never talks to an orchestrator; non-messages are acked and ignored.
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
    let received = 0;
    let unknownNumbers = 0;
    let rejected = 0;
    const instanceByNumber = new Map<string, string | null>();

    for (const entry of envelope.data.entry) {
      for (const change of entry.changes) {
        if (change.field !== MESSAGES_FIELD) continue;
        const value = WebhookChangeValueSchema.safeParse(change.value);
        if (!value.success) {
          rejected += 1;
          this.log.warn(`whatsapp cloud webhook change for entry ${entry.id} rejected: ${value.error.issues.length} issue(s)`);
          continue;
        }
        if (!value.data.messages?.length) continue;
        const messages: InboundMessage[] = [];
        for (const raw of value.data.messages) {
          const message = InboundMessageSchema.safeParse(raw);
          if (message.success) messages.push(message.data);
          else {
            rejected += 1;
            this.log.warn(`whatsapp cloud message in entry ${entry.id} rejected: ${message.error.issues.length} issue(s)`);
          }
        }
        if (messages.length === 0) continue;
        received += messages.length;

        const phoneNumberId = value.data.metadata.phone_number_id;
        let instanceId = instanceByNumber.get(phoneNumberId);
        if (instanceId === undefined) {
          instanceId = await this.store.findInstanceIdByPhoneNumberId(phoneNumberId);
          instanceByNumber.set(phoneNumberId, instanceId);
        }
        if (instanceId === null) {
          unknownNumbers += messages.length;
          this.log.warn(`whatsapp cloud webhook for unknown phone_number_id ${phoneNumberId}`);
          continue;
        }

        const names = new Map<string, string>();
        for (const raw of value.data.contacts ?? []) {
          const contact = ContactSchema.safeParse(raw);
          if (contact.success && contact.data.profile?.name) names.set(contact.data.wa_id, contact.data.profile.name);
        }
        for (const message of messages) rows.push(toRow(instanceId, message, names.get(message.from) ?? null, receivedAt));
      }
    }

    const enqueued = await this.store.enqueue(rows);
    return { received, enqueued, unknownNumbers, rejected };
  }

  private signatureMatches(req: WebhookRequest): boolean {
    if (!req.signature?.startsWith(SIGNATURE_PREFIX)) return false;
    return verifyBodySignature(this.appSecret, req.rawBody, req.signature.slice(SIGNATURE_PREFIX.length));
  }
}

// wa_timestamp is the customer's clock and only orders messages; the 24h window runs from our receipt, like Meta's.
function toRow(instanceId: string, message: InboundMessage, profileName: string | null, receivedAt: Date): InboundRow {
  return {
    wamid: message.id,
    instanceId,
    waId: message.from,
    profileName,
    waTimestamp: new Date(Number(message.timestamp) * 1000),
    receivedAt,
    payload: { from: message.from, profileName, message },
  };
}

function secretsMatch(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
