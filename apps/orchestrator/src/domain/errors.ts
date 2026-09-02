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
