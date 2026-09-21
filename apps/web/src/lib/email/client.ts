import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fetchWithRetry } from "../http/fetch-with-retry";

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const RESEND_URL = "https://api.resend.com/emails";
const FROM = "Agent For All <no-reply@agentforall.co.il>";
const RETRY = { attempts: 3, timeoutMs: 8000, backoffMs: 400 };

const ResendError = z.object({ message: z.string().optional(), name: z.string().optional() });

export class EmailSendError extends Error {
  constructor(readonly status: number | undefined, message: string) {
    super(message);
    this.name = "EmailSendError";
  }
}

export async function sendEmail(email: OutgoingEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new EmailSendError(undefined, "RESEND_API_KEY is not set");

  let res: Response;
  try {
    res = await fetchWithRetry(
      RESEND_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          // One key per send, reused across its retries: a timeout that did deliver never sends twice.
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({ from: FROM, to: [email.to], subject: email.subject, html: email.html, text: email.text }),
      },
      RETRY,
    );
  } catch (err) {
    throw new EmailSendError(undefined, err instanceof Error ? err.message : "network-error");
  }
  if (res.ok) return;

  const payload = ResendError.safeParse(await res.json().catch(() => null));
  throw new EmailSendError(res.status, (payload.success && (payload.data.message ?? payload.data.name)) || `HTTP ${res.status}`);
}
