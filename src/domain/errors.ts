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

export class InvalidStateError extends DomainError {
  readonly statusCode = 409;
  readonly code = "INVALID_STATE";

  constructor(from: string, to: string) {
    super(`cannot transition from '${from}' to '${to}'`);
  }
}

export class PortExhaustedError extends DomainError {
  readonly statusCode = 503;
  readonly code = "PORT_EXHAUSTED";

  constructor(rangeStart: number, rangeEnd: number) {
    super(`no available ports in range ${rangeStart}-${rangeEnd}`);
  }
}

export class ProvisioningError extends DomainError {
  readonly statusCode = 500;
  readonly code = "PROVISIONING_FAILED";

  constructor(instanceId: string, cause: string) {
    super(`provisioning failed for '${instanceId}': ${cause}`);
  }
}

export class AuthenticationError extends DomainError {
  readonly statusCode = 401;
  readonly code = "UNAUTHORIZED";

  constructor() {
    super("missing or invalid authentication");
  }
}

export class AuthorizationError extends DomainError {
  readonly statusCode = 403;
  readonly code = "FORBIDDEN";

  constructor() {
    super("you do not have access to this resource");
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
