export abstract class DomainError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }

  toJSON(): { code: string; message: string } {
    return { code: this.code, message: this.message };
  }
}

export class NotFoundError extends DomainError {
  readonly statusCode = 404;
  readonly code = "NOT_FOUND";

  constructor(entity: string, id: string) {
    super(`${entity} '${id}' not found`);
  }
}

export class ValidationError extends DomainError {
  readonly statusCode = 400;
  readonly code = "VALIDATION_ERROR";
}

export class InvalidStateError extends DomainError {
  readonly statusCode = 409;
  readonly code = "INVALID_STATE";

  constructor(from: string, to: string) {
    super(`cannot transition from '${from}' to '${to}'`);
  }
}

// Rendered config is only valid for the adapter's image; a container from another one is recreated first.
export class RuntimeImageMismatchError extends DomainError {
  readonly statusCode = 409;
  readonly code = "RUNTIME_IMAGE_MISMATCH";

  constructor() {
    super("container runs another runtime image; recreate it before changing its config");
  }
}

export class PortExhaustedError extends DomainError {
  readonly statusCode = 503;
  readonly code = "PORT_EXHAUSTED";

  constructor(rangeStart: number, rangeEnd: number) {
    super(`no available ports in range ${rangeStart}-${rangeEnd}`);
  }
}

export class QuotaExceededError extends DomainError {
  readonly statusCode = 429;
  readonly code = "QUOTA_EXCEEDED";

  constructor(resource: string, limit: number) {
    super(`${resource} limit of ${limit} reached`);
  }
}

export class AuthenticationError extends DomainError {
  readonly statusCode = 401;
  readonly code = "UNAUTHORIZED";

  constructor() {
    super("missing or invalid authentication");
  }
}

export class FeatureUnavailableError extends DomainError {
  readonly statusCode = 503;
  readonly code = "FEATURE_UNAVAILABLE";

  constructor(feature: string) {
    super(`${feature} is not configured on this host`);
  }
}

export class UpstreamUnavailableError extends DomainError {
  readonly statusCode = 502;
  readonly code = "UPSTREAM_UNAVAILABLE";

  constructor(service: string, detail?: string) {
    super(detail ? `${service} unavailable: ${detail}` : `${service} unavailable`);
  }
}

export class InvalidBackupError extends DomainError {
  readonly statusCode = 400;
  readonly code = "INVALID_BACKUP";

  constructor(message: string) {
    super(message);
  }
}

// Usually means ENCRYPTION_KEY was rotated without re-encrypting, or row was tampered with.
export class CorruptedRowError extends DomainError {
  readonly statusCode = 500;
  readonly code = "CORRUPTED_ROW";

  constructor(entity: string, id: string, cause: string) {
    super(`corrupted ${entity} '${id}': ${cause}`);
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export class ConflictError extends DomainError {
  readonly statusCode = 409;
  readonly code = "CONFLICT";
}

// Meta only lets a business reply inside 24h of the customer's last message; anything else is a template.
export class CustomerWindowClosedError extends DomainError {
  readonly statusCode = 409;
  readonly code = "CUSTOMER_WINDOW_CLOSED";

  constructor() {
    super("the customer's 24-hour service window is closed; they must write first");
  }
}

// The owner took this customer over; a bot turn that was already running must not answer over them.
export class ConversationHeldByOwnerError extends DomainError {
  readonly statusCode = 409;
  readonly code = "CONVERSATION_HELD_BY_OWNER";

  constructor() {
    super("the owner is answering this customer; the bot's reply was not sent");
  }
}

// Meta says whether the number is still in the WhatsApp Business app, and the owner picked the other kind.
export class NumberModeMismatchError extends DomainError {
  readonly statusCode = 409;
  readonly code = "NUMBER_MODE_MISMATCH";

  constructor(readonly stillInApp: boolean) {
    super(
      stillInApp
        ? "this number is still in the WhatsApp Business app; connect it keeping the app"
        : "this number is not in the WhatsApp Business app; connect it as a new number",
    );
  }
}

export class ChannelCredentialError extends DomainError {
  readonly statusCode = 409;
  readonly code = "CHANNEL_CREDENTIAL_INVALID";

  constructor(channel: string) {
    super(`${channel} credentials were revoked or expired; reconnect the channel`);
  }
}

export class AccountLimitReachedError extends DomainError {
  readonly statusCode = 409;
  readonly code = "ACCOUNT_LIMIT_REACHED";

  constructor(app: string, limit: number) {
    super(`${app} already has the maximum of ${limit} connected accounts`);
  }
}

export class AccountLabelTakenError extends DomainError {
  readonly statusCode = 409;
  readonly code = "ACCOUNT_LABEL_TAKEN";

  constructor(app: string) {
    super(`another ${app} account already has that name`);
  }
}

export class UpstreamRateLimitedError extends DomainError {
  readonly statusCode = 429;
  readonly code = "UPSTREAM_RATE_LIMITED";

  constructor(service: string) {
    super(`${service} is rate limiting this bot; try again shortly`);
  }
}

export class ChannelPinRequiredError extends DomainError {
  readonly statusCode = 409;
  readonly code = "CHANNEL_PIN_REQUIRED";
  constructor() {
    super("this number has a two-step verification PIN; enter it to connect");
  }
}

export class MediaTooLargeError extends DomainError {
  readonly statusCode = 413;
  readonly code = "MEDIA_TOO_LARGE";

  constructor() {
    super("media is larger than the platform cap");
  }
}

export class OwnerUnreachableError extends DomainError {
  readonly statusCode = 409;
  readonly code = "OWNER_UNREACHABLE";
  constructor() {
    super("the owner cannot be reached on Telegram; they must open a chat with their bot first");
  }
}
