import { timingSafeEqual } from "node:crypto";

const AUTH_TOKEN_LENGTH = 64;
const DUMMY_TOKEN_BUFFER = Buffer.alloc(AUTH_TOKEN_LENGTH, 0);

export interface PairSession {
  instanceId: string;
  sidecarContainerId: string;
  sidecarContainerName: string;
  sidecarHostPort: number | null;
  authToken: string;
  createdAt: Date;
}

export class PairingSessionRegistry {
  private readonly sessions = new Map<string, PairSession>();
  private readonly locks = new Map<string, Promise<void>>();

  get(instanceId: string): PairSession | undefined {
    return this.sessions.get(instanceId);
  }

  set(session: PairSession): void {
    this.sessions.set(session.instanceId, session);
  }

  has(instanceId: string): boolean {
    return this.sessions.has(instanceId);
  }

  delete(instanceId: string): void {
    this.sessions.delete(instanceId);
  }

  validateToken(instanceId: string, token: string): boolean {
    if (!/^[0-9a-f]{64}$/i.test(token)) return false;
    const candidate = Buffer.from(token, "utf8");
    if (candidate.length !== DUMMY_TOKEN_BUFFER.length) return false;
    const session = this.sessions.get(instanceId);
    const secret = session
      ? Buffer.from(session.authToken, "utf8")
      : DUMMY_TOKEN_BUFFER;
    const equal = timingSafeEqual(candidate, secret);
    return equal && session !== undefined;
  }

  async withInstanceLock<T>(
    instanceId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const previous = this.locks.get(instanceId) ?? Promise.resolve();
    let release = (): void => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.locks.set(instanceId, tail);

    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(instanceId) === tail) {
        this.locks.delete(instanceId);
      }
    }
  }
}
