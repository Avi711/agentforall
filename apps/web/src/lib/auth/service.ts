import "server-only";
import { createHash } from "node:crypto";
import { EmailSendError, sendEmail, type OutgoingEmail } from "../email/client";
import { AuthRepository } from "./repository";
import type { AuthEmailKind } from "./email-password";
import { EMAIL_VERIFICATION_TTL_HOURS, UNVERIFIED_SIGN_UP_MAX_AGE_DAYS } from "./policy";

const HOUR_MS = 60 * 60 * 1000;
const RATE_LIMIT_ROW_TTL_MS = 24 * HOUR_MS;
const MAX_EMAILS_PER_KIND_PER_HOUR = 5;

type Sender = (email: OutgoingEmail) => Promise<void>;

export class AuthService {
  private readonly repo: AuthRepository;
  private readonly send: Sender;

  constructor(repo?: AuthRepository, send: Sender = sendEmail) {
    this.repo = repo ?? new AuthRepository();
    this.send = send;
  }

  // Never throws: failures are logged here without the address, so callers need no guard.
  async deliver(kind: AuthEmailKind, email: OutgoingEmail): Promise<void> {
    try {
      // Capped per inbox and kind, so no one can flood an inbox or starve one kind with another; the security notice is exempt.
      if (kind !== "password-changed" && !(await this.withinCap(kind, email.to))) {
        console.warn("[auth-email] recipient cap reached", { kind });
        return;
      }
      await this.send(email);
    } catch (err) {
      const status = err instanceof EmailSendError ? err.status : undefined;
      const message = (err instanceof Error ? err.message : String(err)).split(email.to).join("[recipient]");
      console.error("[auth-email] send failed", { kind, status, message });
    }
  }

  async claimAccount(userId: string): Promise<void> {
    await this.repo.claimAccount(userId);
  }

  // The purge counts from the last link sent, so no live link outlives its account.
  async noteVerificationSent(userId: string): Promise<void> {
    await this.repo.touchUser(userId);
  }

  // The hard age cap keeps anyone from holding an email forever by re-requesting links.
  async purgeAbandonedSignUps(now = new Date()): Promise<{ deleted: number; rateLimitRows: number }> {
    const deleted = await this.repo.deleteUnverifiedPasswordSignUps(
      new Date(now.getTime() - EMAIL_VERIFICATION_TTL_HOURS * HOUR_MS),
      new Date(now.getTime() - UNVERIFIED_SIGN_UP_MAX_AGE_DAYS * 24 * HOUR_MS),
    );
    const rateLimitRows = await this.repo.deleteRateLimitRowsBefore(now.getTime() - RATE_LIMIT_ROW_TTL_MS);
    return { deleted, rateLimitRows };
  }

  private async withinCap(kind: AuthEmailKind, address: string): Promise<boolean> {
    const recipient = createHash("sha256").update(address.trim().toLowerCase()).digest("hex");
    return (await this.repo.countHit(`email:${kind}:${recipient}`, HOUR_MS)) <= MAX_EMAILS_PER_KIND_PER_HOUR;
  }
}

let service: AuthService | undefined;
export function getAuthService(): AuthService {
  service ??= new AuthService();
  return service;
}
