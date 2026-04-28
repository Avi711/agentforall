import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { sendLeadEvent } from "../meta-capi";
import { LeadRepository, type Lead } from "./repository";
import type { LeadSubmission } from "./schemas";

// Postgres unique_violation — fires if a unique index is added on email.
const PG_UNIQUE_VIOLATION = "23505";

export interface SubmissionContext {
  clientIp: string | null;
  userAgent?: string;
  referer?: string;
  fbp?: string;
  fbc?: string;
}

export interface SubmissionResult {
  duplicate: boolean;
}

export class LeadService {
  private readonly repo: LeadRepository;

  constructor(repo?: LeadRepository) {
    this.repo = repo ?? new LeadRepository();
  }

  async submit(
    input: LeadSubmission,
    ctx: SubmissionContext,
  ): Promise<SubmissionResult> {
    const email = input.email.trim().toLowerCase();

    if (await this.repo.existsByEmail(email)) {
      return { duplicate: true };
    }

    try {
      await this.repo.insert({
        name: input.name,
        email,
        phone: input.phone,
        platform: input.platform,
        interest: input.interest ?? null,
        source: "landing-page",
      });
    } catch (err) {
      // Race against a concurrent insert: degrade gracefully into a duplicate.
      const pgError = err as { code?: string };
      if (pgError.code === PG_UNIQUE_VIOLATION) {
        return { duplicate: true };
      }
      throw err;
    }

    const eventId = input.eventId ?? randomUUID();
    after(() =>
      sendLeadEvent({
        eventId,
        email,
        phone: input.phone,
        name: input.name,
        externalId: email,
        clientIp: ctx.clientIp ?? undefined,
        userAgent: ctx.userAgent,
        eventSourceUrl: ctx.referer,
        fbp: ctx.fbp,
        fbc: ctx.fbc,
      }),
    );

    return { duplicate: false };
  }

  async list(): Promise<Lead[]> {
    return this.repo.listNewestFirst();
  }

  async remove(id: string): Promise<void> {
    await this.repo.deleteById(id);
  }
}

export const leadService = new LeadService();
